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
import { getMailboxSettings } from './settings';
import {
  classifyMail,
  extractListings,
  extractReplyText,
  parseAlertEmail,
  routeFromRecipients,
  type RawEmail,
} from '@/domain/mail';
import { ingestListing } from '@/server/listingIngest';
import { loadMailbox } from '@/server/portalAccounts';
import { tokenFromAddress } from '@/server/outbound';
import { closeReplyCheck, notify } from '@/server/followUps';

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
}

export function readMailConfigFromEnv(): MailConfig | null {
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

/**
 * Prefers the mailbox an admin configured in the settings, and falls back to
 * the environment variables that predate it. The settings route exists so the
 * team can set this up themselves; the env route keeps existing deployments
 * working untouched.
 */
export async function readMailConfig(accountId?: string): Promise<MailConfig | null> {
  const stored = await loadMailbox(accountId);
  if (stored.ok) {
    const meta = stored.credentials;
    return {
      host: meta.imapHost,
      port: meta.imapPort,
      secure: meta.imapSecure,
      user: meta.user,
      password: meta.imapPassword,
      mailbox: 'INBOX',
    };
  }
  return readMailConfigFromEnv();
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
export async function ingestMailbox(
  options: { limit?: number; accountId?: string } = {},
): Promise<IngestSummary> {
  const cfg = await readMailConfig(options.accountId);
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
  const mailbox = await getMailboxSettings();
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
    // Which mails to look at.
    //
    // Read-only: everything that arrived in the lookback window, and the
    // Message-ID log decides what is new. Nothing is written to the mailbox, so
    // a shared inbox worked in Front keeps its unread state exactly as the team
    // left it.
    //
    // The older behaviour — search unseen, then flag as seen — is still
    // available for a mailbox nobody else reads, because it is cheaper on a
    // busy account.
    const since = new Date(Date.now() - mailbox.lookbackDays * 86_400_000);
    const uids = mailbox.readOnly
      ? await client.search({ since })
      : await client.search({ seen: false });
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

        const result = await applyMail(raw, systemUser.id);
        summary.processed += result.status === 'PROCESSED' ? 1 : 0;
        summary.listingsCreated += result.created;
        if (result.status !== 'PROCESSED') summary.skipped++;
        if (result.note) summary.messages.push(result.note);

        // Only when the mailbox is ours alone. See MailboxSettings.readOnly.
        if (!mailbox.readOnly) {
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        }
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

/**
 * Reads every mailbox that is set up, one after another.
 *
 * One account was the assumption for a long time; in practice there are
 * several — the Suchauftrag address, the shared inbox the team works in Front,
 * and a test account while the next one is being set up. A failure on one is
 * reported and does not stop the others: a wrong password on the test account
 * must never cost a day of replies on the real one.
 */
export async function ingestAllMailboxes(options: { limit?: number } = {}): Promise<IngestSummary> {
  const { listMailboxes } = await import('@/server/portalAccounts');
  const boxes = await listMailboxes();

  // No account rows at all: fall back to the environment-configured mailbox,
  // which is how a fresh installation and the tests are set up.
  if (boxes.length === 0) return ingestMailbox(options);

  const total: IngestSummary = {
    configured: true,
    examined: 0,
    processed: 0,
    listingsCreated: 0,
    skipped: 0,
    errors: 0,
    messages: [],
  };

  for (const box of boxes) {
    const one = await ingestMailbox({ ...options, accountId: box.id });
    total.examined += one.examined;
    total.processed += one.processed;
    total.listingsCreated += one.listingsCreated;
    total.skipped += one.skipped;
    total.errors += one.errors;
    for (const m of one.messages) total.messages.push(`${box.label}: ${m}`);
  }
  return total;
}

type ParsedAlert = ReturnType<typeof parseAlertEmail>;

/**
 * Routes one mail: a landlord's answer is appended to the conversation it
 * belongs to, everything else goes down the new-listings path.
 */
async function applyMail(
  raw: RawEmail,
  userId: string,
): Promise<{ status: string; created: number; note?: string }> {
  const body = raw.html || raw.text || '';

  // Strongest signal first: an Anfrage we sent ourselves carries a random token
  // in its Reply-To address, so the answer identifies its own conversation. No
  // wording heuristic can compete with that, and landlords rewrite subject
  // lines constantly.
  const tokenAttempt = await matchByThreadToken(raw.recipients);
  if (tokenAttempt) {
    return applyTokenReply(raw, tokenAttempt);
  }

  const { listings } = extractListings(body);
  const urls = listings.map((l) => l.url);

  // Which of these have we actually written to? That is the strongest signal
  // that this mail is a reply rather than a digest.
  const contactedListings = urls.length
    ? await prisma.listing.findMany({
        where: { rawUrl: { in: urls }, contactAttempts: { some: {} } },
        select: { id: true, rawUrl: true, title: true },
      })
    : [];
  const contactedUrls = new Set(contactedListings.map((l) => l.rawUrl));

  const kind = classifyMail({ subject: raw.subject, from: raw.from, body }, urls, contactedUrls);

  if (kind.kind === 'REPLY' && contactedListings.length === 1) {
    return applyReply(raw, contactedListings[0], userId, kind.reason);
  }

  return applyAlert(parseAlertEmail(raw), raw, userId);
}

/**
 * Finds the enquiry a reply belongs to from the plus-addressed token, e.g.
 * `post+ab12cd@firma.de`. Returns null when no recipient carries a token we
 * issued — which is the normal case for portal alert mail.
 */
async function matchByThreadToken(recipients: string[]) {
  const tokens = recipients.map(tokenFromAddress).filter((t): t is string => !!t);
  if (tokens.length === 0) return null;

  return prisma.contactAttempt.findFirst({
    where: { threadToken: { in: tokens } },
    include: {
      listing: { select: { id: true, title: true } },
      candidateCase: { select: { id: true, reference: true } },
    },
  });
}

/** Logs a reply that identified itself through our own token. */
async function applyTokenReply(
  raw: RawEmail,
  attempt: {
    id: string;
    listing: { id: string; title: string };
    candidateCase: { id: string; reference: string };
  },
): Promise<{ status: string; created: number; note?: string }> {
  const text = extractReplyText(raw.html || raw.text || '');

  // The unique Message-ID makes this safe to run twice.
  const existing = await prisma.contactMessage.findUnique({ where: { externalId: raw.messageId } });
  if (existing) return { status: 'SKIPPED', created: 0 };

  await prisma.contactMessage.create({
    data: {
      contactAttemptId: attempt.id,
      direction: 'INCOMING',
      body: text || '(Leere Nachricht — bitte im Portal nachsehen)',
      subject: raw.subject,
      fromAddress: raw.from,
      externalId: raw.messageId,
      occurredAt: raw.receivedAt,
      // Left unread on purpose: unread replies are what the badge counts.
      readAt: null,
    },
  });

  // Somebody answered, so "check whether they answered" is done. Whether the
  // answer is a yes stays a human judgement — outcome remains AWAITING.
  await closeReplyCheck(attempt.id);

  await notify({
    kind: 'REPLY_RECEIVED',
    title: `Antwort erhalten: ${attempt.listing.title}`,
    body: text.slice(0, 300),
    url: `/kandidat/${attempt.candidateCase.id}/kontakte`,
    candidateCaseId: attempt.candidateCase.id,
    listingId: attempt.listing.id,
    contactAttemptId: attempt.id,
  });

  await prisma.emailIngestLog.create({
    data: {
      messageId: raw.messageId,
      fromAddress: raw.from,
      subject: raw.subject,
      receivedAt: raw.receivedAt,
      candidateCaseId: attempt.candidateCase.id,
      status: 'REPLY_LOGGED',
      listingsSeen: 1,
      note: `Antwort über Thread-Kennung zugeordnet — „${attempt.listing.title}" für ${attempt.candidateCase.reference}.`,
    },
  });

  const { notifyReplyReceived } = await import('@/server/telegram');
  await notifyReplyReceived({
    candidateReference: attempt.candidateCase.reference,
    candidateCaseId: attempt.candidateCase.id,
    listingTitle: attempt.listing.title,
    excerpt: text.slice(0, 300),
  });

  return { status: 'REPLY_LOGGED', created: 0, note: `Antwort zu „${attempt.listing.title}" gespeichert.` };
}

/** Appends a landlord's answer to the right conversation. */
async function applyReply(
  raw: RawEmail,
  listing: { id: string; rawUrl: string; title: string },
  userId: string,
  reason: string,
): Promise<{ status: string; created: number; note?: string }> {
  const base = {
    messageId: raw.messageId,
    fromAddress: raw.from,
    subject: raw.subject,
    receivedAt: raw.receivedAt,
    sourceKey: null,
    listingsSeen: 1,
  };

  // A listing can be contacted for several candidates; the plus-address tells
  // us which conversation this belongs to.
  const candidateRef = routeFromRecipients(raw.recipients);
  const attempts = await prisma.contactAttempt.findMany({
    where: {
      listingId: listing.id,
      ...(candidateRef ? { candidateCase: { reference: candidateRef } } : {}),
    },
    include: { candidateCase: { select: { id: true, reference: true } } },
    orderBy: { contactedAt: 'desc' },
  });

  if (attempts.length !== 1) {
    await prisma.emailIngestLog.create({
      data: {
        ...base,
        status: 'UNMATCHED_REPLY',
        note:
          attempts.length === 0
            ? `Antwort zu „${listing.title}", aber kein passender Kontakt gefunden.`
            : `Antwort zu „${listing.title}" ist mehrdeutig (${attempts.length} Kontakte) — bitte manuell zuordnen.`,
      },
    });
    return { status: 'UNMATCHED_REPLY', created: 0 };
  }

  const attempt = attempts[0];
  const text = extractReplyText(raw.html || raw.text || '');

  await prisma.contactMessage.create({
    data: {
      contactAttemptId: attempt.id,
      direction: 'INCOMING',
      body: text || '(Leere Nachricht — bitte im Portal nachsehen)',
      subject: raw.subject,
      fromAddress: raw.from,
      externalId: raw.messageId,
      occurredAt: raw.receivedAt,
      recordedById: userId,
      readAt: null,
    },
  });

  await closeReplyCheck(attempt.id);
  await notify({
    kind: 'REPLY_RECEIVED',
    title: `Antwort erhalten: ${listing.title}`,
    body: text.slice(0, 300),
    url: `/kandidat/${attempt.candidateCase.id}/kontakte`,
    candidateCaseId: attempt.candidateCase.id,
    listingId: listing.id,
    contactAttemptId: attempt.id,
  });

  // The answer's content is a human judgement, so the outcome stays AWAITING
  // until a colleague reads it and decides. Only the fact of an answer is
  // recorded automatically.
  await prisma.emailIngestLog.create({
    data: {
      ...base,
      candidateCaseId: attempt.candidateCase.id,
      status: 'REPLY_LOGGED',
      note: `${reason} — Antwort zu „${listing.title}" für ${attempt.candidateCase.reference}.`,
    },
  });

  const { notifyReplyReceived } = await import('@/server/telegram');
  await notifyReplyReceived({
    candidateReference: attempt.candidateCase.reference,
    candidateCaseId: attempt.candidateCase.id,
    listingTitle: listing.title,
    excerpt: text.slice(0, 300),
  });

  return {
    status: 'REPLY_LOGGED',
    created: 0,
    note: `Antwort von „${listing.title}" im Verlauf gespeichert.`,
  };
}

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
      const { listingId } = await ingestListing({
        sourceId: source.id,
        rawUrl: l.url,
        title: l.title || raw.subject || 'Anzeige aus Suchagent',
        // Alert mails rarely carry the full description; the colleague opens
        // the listing to complete it. We never invent text here.
        descriptionRaw: '',
        importedById: userId,
      });

      // A search-agent mail announces *new* results, so its arrival is within
      // hours of publication. That makes it a real publication date — and for
      // ImmoScout24, which refuses to be read at all (HTTP 401), it is the only
      // one we will ever get. Never overwritten: a later mail re-listing the
      // same flat does not make it younger.
      await prisma.listing.updateMany({
        where: { id: listingId, postedAt: null },
        data: {
          postedAt: raw.receivedAt,
          postedAtLabel: `Vom Suchagenten gemeldet am ${raw.receivedAt.toLocaleDateString('de-DE')}`,
        },
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
