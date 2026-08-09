/**
 * Reads portal alert emails from a shared mailbox and turns them into listings.
 *
 * Why this and not a scraper: the portals send these emails on purpose, to an
 * address we chose, because a colleague created a saved search with their own
 * account. Nothing here bypasses a login, a rate limit or a robots policy, and
 * it keeps working when a portal redesigns its website.
 *
 * Credentials come from the environment only — never the database, never git.
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { prisma } from '@/lib/prisma';
import { parseAlertEmail, type RawEmail } from '@/domain/mail';
import { ingestListing } from '@/server/listingIngest';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
}

export function readMailConfig(): MailConfig | null {
  const host = process.env.MAIL_IMAP_HOST;
  const user = process.env.MAIL_IMAP_USER;
  const password = process.env.MAIL_IMAP_PASSWORD;
  if (!host || !user || !password) return null;
  return {
    host,
    port: Number(process.env.MAIL_IMAP_PORT ?? 993),
    secure: (process.env.MAIL_IMAP_SECURE ?? 'true') !== 'false',
    user,
    password,
    mailbox: process.env.MAIL_IMAP_MAILBOX ?? 'INBOX',
  };
}

export interface IngestSummary {
  configured: boolean;
  examined: number;
  processed: number;
  listingsCreated: number;
  skipped: number;
  errors: number;
  messages: string[];
}

/**
 * Fetches unseen mail, creates listings, and records one log row per message.
 * Idempotent: a Message-ID we have already logged is skipped, so a re-run or an
 * overlapping cron can never duplicate a listing.
 */
export async function ingestMailbox(options: { limit?: number } = {}): Promise<IngestSummary> {
  const cfg = readMailConfig();
  const summary: IngestSummary = {
    configured: cfg != null,
    examined: 0,
    processed: 0,
    listingsCreated: 0,
    skipped: 0,
    errors: 0,
    messages: [],
  };
  if (!cfg) {
    summary.messages.push('Kein Postfach konfiguriert (MAIL_IMAP_HOST/USER/PASSWORD fehlen).');
    return summary;
  }

  const limit = options.limit ?? 50;
  const systemUser = await prisma.user.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!systemUser) {
    summary.messages.push('Kein aktiver Benutzer vorhanden — Import übersprungen.');
    return summary;
  }

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(cfg.mailbox);
  try {
    const uids = await client.search({ seen: false });
    const slice = (uids || []).slice(-limit);

    for (const uid of slice) {
      summary.examined++;
      let messageId = `uid-${uid}@${cfg.host}`;
      try {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        messageId = parsed.messageId ?? messageId;

        // Idempotency gate.
        const already = await prisma.emailIngestLog.findUnique({ where: { messageId } });
        if (already) {
          summary.skipped++;
          continue;
        }

        const recipients = [
          ...toAddressList(parsed.to),
          ...toAddressList(parsed.cc),
          ...headerAddresses(parsed.headers.get('delivered-to')),
          ...headerAddresses(parsed.headers.get('x-original-to')),
        ];

        const raw: RawEmail = {
          messageId,
          from: parsed.from?.value?.[0]?.address ?? '',
          recipients,
          subject: parsed.subject ?? '',
          html: typeof parsed.html === 'string' ? parsed.html : null,
          text: parsed.text ?? null,
          receivedAt: parsed.date ?? new Date(),
        };

        const alert = parseAlertEmail(raw);
        const result = await applyAlert(alert, raw, systemUser.id);
        summary.processed += result.status === 'PROCESSED' ? 1 : 0;
        summary.listingsCreated += result.created;
        if (result.status !== 'PROCESSED') summary.skipped++;
        if (result.note) summary.messages.push(result.note);

        // Mark handled so the next run does not look at it again.
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      } catch (err) {
        summary.errors++;
        const note = (err as Error).message.slice(0, 300);
        summary.messages.push(`Fehler bei einer Nachricht: ${note}`);
        await prisma.emailIngestLog
          .create({
            data: {
              messageId,
              fromAddress: '',
              subject: '',
              receivedAt: new Date(),
              status: 'ERROR',
              note,
            },
          })
          .catch(() => undefined);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }

  return summary;
}

type ParsedAlert = ReturnType<typeof parseAlertEmail>;

async function applyAlert(
  alert: ParsedAlert,
  raw: RawEmail,
  userId: string,
): Promise<{ status: string; created: number; note?: string }> {
  const base = {
    messageId: raw.messageId,
    fromAddress: raw.from,
    subject: raw.subject,
    receivedAt: raw.receivedAt,
    sourceKey: alert.sourceKey,
    listingsSeen: alert.listings.length,
  };

  if (alert.listings.length === 0 || !alert.sourceKey) {
    await prisma.emailIngestLog.create({
      data: { ...base, status: 'NO_LINKS', note: 'Keine erkennbaren Anzeigen-Links.' },
    });
    return { status: 'NO_LINKS', created: 0 };
  }

  const source = await prisma.source.findUnique({ where: { key: alert.sourceKey } });
  if (!source) {
    await prisma.emailIngestLog.create({
      data: { ...base, status: 'UNKNOWN_SOURCE', note: `Quelle "${alert.sourceKey}" nicht im Katalog.` },
    });
    return { status: 'UNKNOWN_SOURCE', created: 0 };
  }

  // Route to a candidate via the plus-addressed recipient.
  let candidate = null;
  if (alert.candidateReference) {
    candidate = await prisma.candidateCase.findUnique({
      where: { reference: alert.candidateReference },
      select: { id: true, reference: true },
    });
  }
  if (!candidate) {
    await prisma.emailIngestLog.create({
      data: {
        ...base,
        status: 'UNKNOWN_CANDIDATE',
        note: alert.candidateReference
          ? `Kandidat "${alert.candidateReference}" nicht gefunden.`
          : 'Keine Kandidatenkennung in der Empfängeradresse (z. B. postfach+CAND-2026-014@…).',
      },
    });
    return { status: 'UNKNOWN_CANDIDATE', created: 0 };
  }

  let created = 0;
  for (const l of alert.listings) {
    try {
      await ingestListing({
        sourceId: source.id,
        rawUrl: l.url,
        title: l.title || raw.subject || 'Anzeige aus Suchagent',
        // Alert mails rarely carry the full description; the colleague opens
        // the listing to complete it. We never invent text here.
        descriptionRaw: '',
        importedById: userId,
      });
      created++;
    } catch {
      // A single bad link must not abort the whole message.
    }
  }

  await prisma.emailIngestLog.create({
    data: {
      ...base,
      candidateCaseId: candidate.id,
      listingsCreated: created,
      status: 'PROCESSED',
    },
  });

  return {
    status: 'PROCESSED',
    created,
    note: `${created} Anzeige(n) für ${candidate.reference} aus ${source.name}.`,
  };
}

/* ------------------------------------------------------------------ utils */

function toAddressList(field: unknown): string[] {
  if (!field) return [];
  const anyField = field as { value?: Array<{ address?: string }> };
  return (anyField.value ?? []).map((v) => v.address ?? '').filter(Boolean);
}

function headerAddresses(header: unknown): string[] {
  if (!header) return [];
  if (typeof header === 'string') return [header];
  if (Array.isArray(header)) return header.filter((h): h is string => typeof h === 'string');
  return [];
}
