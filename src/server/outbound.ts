/**
 * Sending an Anfrage from inside the tool.
 *
 * Ordering is the whole design here. The contact is **recorded before it is
 * sent**, because the two failure modes are not equal: a recorded message that
 * failed to send is visible, retryable and costs nothing, while a sent message
 * that was never recorded means a second colleague writes to the same landlord
 * about the same flat. So the attempt reserves its slot first — the existing
 * `confirmContact` guards still decide whether contacting at all is allowed —
 * and delivery status is written back afterwards.
 *
 * Replies come back through plus-addressing: every attempt carries a random
 * token, `Reply-To` is `postfach+<token>@…`, and the mailbox reader matches on
 * it. That beats guessing from the subject line, which landlords rewrite.
 */

import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { newThreadToken } from '@/lib/crypto';
import { loadMailbox, markAccountStatus } from './portalAccounts';
import { getOutboundSettings } from './settings';
import { confirmContact } from './contact';
import { notify, scheduleReplyCheck } from './followUps';

export type SendResult =
  | { ok: true; contactAttemptId: string; sentTo: string; followUpAt: Date }
  | { ok: false; reason: string; code: SendFailureCode; contactAttemptId?: string };

export type SendFailureCode =
  | 'DISABLED'
  | 'NO_MAILBOX'
  | 'NO_ADDRESS'
  | 'RATE_LIMITED'
  | 'ALREADY_CONTACTED'
  | 'MESSAGE_EMPTY'
  | 'NOT_FOUND'
  | 'SEND_FAILED';

export interface SendAnfrageInput {
  candidateCaseId: string;
  listingId: string;
  userId: string;
  /** Overrides the candidate's standard message for this one enquiry. */
  bodyOverride?: string;
  overrideReason?: string;
}

/**
 * Adds the plus-addressed token to the sending address:
 * `post@firma.de` → `post+ab12cd@firma.de`.
 */
export function replyToWithToken(address: string, token: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return address;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  // Never stack tokens if the configured address already carries one.
  const base = local.split('+')[0];
  return `${base}+${token}@${domain}`;
}

/** Reads the token back out of an address the mailbox received. */
export function tokenFromAddress(address: string): string | null {
  const match = address.match(/\+([A-Za-z0-9_-]{6,})@/);
  return match ? match[1] : null;
}

export function fillSubject(template: string, listing: { title: string; locationCity: string | null }): string {
  return template
    .replace(/\{title\}/g, listing.title)
    .replace(/\{city\}/g, listing.locationCity ?? '')
    .trim()
    .slice(0, 200);
}

export async function sendAnfrage(input: SendAnfrageInput): Promise<SendResult> {
  const settings = await getOutboundSettings();
  if (!settings.enabled) {
    return {
      ok: false,
      code: 'DISABLED',
      reason:
        'Versand aus der App ist ausgeschaltet. In den Einstellungen unter „Konten & Postfach" aktivieren.',
    };
  }
  if (!settings.fromAddress.trim()) {
    return { ok: false, code: 'NO_MAILBOX', reason: 'Keine Absenderadresse konfiguriert.' };
  }

  const listing = await prisma.listing.findUnique({
    where: { id: input.listingId },
    select: {
      id: true,
      title: true,
      canonicalUrl: true,
      contactEmail: true,
      contactFormUrl: true,
      locationCity: true,
      expired: true,
      source: { select: { name: true, websiteUrl: true } },
    },
  });
  if (!listing) return { ok: false, code: 'NOT_FOUND', reason: 'Anzeige nicht gefunden.' };

  if (!listing.contactEmail) {
    // Most large portals deliberately hide the address behind their own form.
    // Saying so plainly is more use than a generic failure.
    return {
      ok: false,
      code: 'NO_ADDRESS',
      reason: `Diese Anzeige veröffentlicht keine E-Mail-Adresse — ${listing.source.name} nimmt Anfragen nur über das eigene Formular an. Anzeige öffnen, dort schreiben und die Anfrage hier als „gesendet" erfassen.`,
    };
  }

  const mailbox = await loadMailbox();
  if (!mailbox.ok) return { ok: false, code: 'NO_MAILBOX', reason: mailbox.reason };

  // A whole-team cap: a burst of automated Anfragen is exactly the behaviour
  // that gets a sending domain blacklisted.
  const sentLastHour = await prisma.contactAttempt.count({
    where: { deliveryStatus: 'SENT', contactedAt: { gte: new Date(Date.now() - 3_600_000) } },
  });
  if (sentLastHour >= settings.maxPerHour) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      reason: `Stündliches Limit von ${settings.maxPerHour} Anfragen erreicht. Der Rest folgt automatisch in der nächsten Stunde.`,
    };
  }

  // Reserve the contact first — see the module comment on ordering.
  const recorded = await confirmContact({
    candidateCaseId: input.candidateCaseId,
    listingId: input.listingId,
    userId: input.userId,
    overrideReason: input.overrideReason,
  });
  if (!recorded.ok) {
    if (recorded.reason === 'MESSAGE_EMPTY') {
      return {
        ok: false,
        code: 'MESSAGE_EMPTY',
        reason: 'Für diesen Kandidaten ist noch kein Anschreiben hinterlegt.',
      };
    }
    return {
      ok: false,
      code: recorded.reason === 'LISTING_NOT_FOUND' || recorded.reason === 'CANDIDATE_NOT_FOUND' ? 'NOT_FOUND' : 'ALREADY_CONTACTED',
      reason: describeContactRefusal(recorded),
    };
  }

  const attemptId = recorded.contactAttemptId;
  const token = newThreadToken();
  const replyTo = replyToWithToken(settings.fromAddress, token);
  const subject = fillSubject(settings.subjectTemplate, listing);

  const attempt = await prisma.contactAttempt.update({
    where: { id: attemptId },
    data: {
      channel: 'EMAIL',
      deliveryStatus: 'PENDING',
      sentToAddress: listing.contactEmail,
      threadToken: token,
      ...(input.bodyOverride?.trim() ? { messageSnapshot: input.bodyOverride.trim() } : {}),
    },
    select: { messageSnapshot: true },
  });

  const body = buildBody(attempt.messageSnapshot, listing);

  try {
    const transport = nodemailer.createTransport({
      host: mailbox.credentials.smtpHost,
      port: mailbox.credentials.smtpPort,
      secure: mailbox.credentials.smtpSecure,
      auth: { user: mailbox.credentials.user, pass: mailbox.credentials.password },
    });

    const info = await transport.sendMail({
      from: { name: settings.fromName, address: settings.fromAddress },
      to: listing.contactEmail,
      replyTo,
      subject,
      text: body,
    });

    await prisma.contactAttempt.update({
      where: { id: attemptId },
      data: { deliveryStatus: 'SENT', deliveryError: null, outboundMessageId: info.messageId ?? null },
    });
    await prisma.contactMessage.create({
      data: {
        contactAttemptId: attemptId,
        direction: 'OUTGOING',
        body,
        subject,
        recordedById: input.userId,
        externalId: info.messageId ?? null,
        // Our own message needs no reading.
        readAt: new Date(),
      },
    });
    await markAccountStatus(mailbox.credentials.accountId, 'OK', null);
    await scheduleReplyCheck(attemptId);

    const task = await prisma.followUpTask.findUnique({
      where: { contactAttemptId_kind: { contactAttemptId: attemptId, kind: 'CHECK_REPLY' } },
      select: { dueAt: true },
    });

    return {
      ok: true,
      contactAttemptId: attemptId,
      sentTo: listing.contactEmail,
      followUpAt: task?.dueAt ?? new Date(),
    };
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    await prisma.contactAttempt.update({
      where: { id: attemptId },
      data: { deliveryStatus: 'FAILED', deliveryError: message },
    });
    // The flat was not actually contacted, so it must not look contacted.
    await prisma.candidateListingMatch.updateMany({
      where: { candidateCaseId: input.candidateCaseId, listingId: input.listingId },
      data: { status: 'IN_PROGRESS' },
    });
    await markAccountStatus(mailbox.credentials.accountId, 'FAILED', message);
    await notify({
      kind: 'SEND_FAILED',
      title: `Anfrage konnte nicht gesendet werden: ${listing.title}`,
      body: message,
      candidateCaseId: input.candidateCaseId,
      listingId: input.listingId,
      contactAttemptId: attemptId,
    });

    return {
      ok: false,
      code: 'SEND_FAILED',
      reason: `Versand fehlgeschlagen: ${message}`,
      contactAttemptId: attemptId,
    };
  }
}

/**
 * Appends the reference line a landlord needs to know which ad we mean. The
 * colleague's own text is never rewritten — only followed.
 */
function buildBody(
  message: string,
  listing: { title: string; canonicalUrl: string; source: { name: string } },
): string {
  return [
    message.trim(),
    '',
    '---',
    `Betrifft Ihre Anzeige: ${listing.title}`,
    `Quelle: ${listing.source.name} — ${listing.canonicalUrl}`,
  ].join('\n');
}

function describeContactRefusal(result: Record<string, unknown>): string {
  if (result.reason === 'ALREADY_CONTACTED_SAME_CANDIDATE') {
    return 'Dieser Kandidat wurde für diese Wohnung bereits angefragt.';
  }
  if (result.reason === 'ALREADY_CONTACTED_OTHER_CANDIDATE') {
    return `Diese Wohnung wurde bereits für ${result.otherCandidate} angefragt (${result.by}). Doppelte Anfragen an denselben Vermieter schaden allen Kandidaten.`;
  }
  return 'Anfrage nicht möglich.';
}

/**
 * Retries an Anfrage whose delivery failed. Deliberately separate from
 * `sendAnfrage`: the contact already exists, so the duplicate guards must not
 * run again and reject their own record.
 */
export async function retrySend(
  contactAttemptId: string,
  userId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const attempt = await prisma.contactAttempt.findUnique({
    where: { id: contactAttemptId },
    include: {
      listing: { select: { id: true, title: true, canonicalUrl: true, contactEmail: true, locationCity: true, source: { select: { name: true } } } },
    },
  });
  if (!attempt) return { ok: false, reason: 'Anfrage nicht gefunden.' };
  if (attempt.deliveryStatus === 'SENT') return { ok: false, reason: 'Diese Anfrage wurde bereits gesendet.' };

  const target = attempt.sentToAddress ?? attempt.listing.contactEmail;
  if (!target) return { ok: false, reason: 'Keine Empfängeradresse bekannt.' };

  const [settings, mailbox] = await Promise.all([getOutboundSettings(), loadMailbox()]);
  if (!settings.enabled) return { ok: false, reason: 'Versand ist ausgeschaltet.' };
  if (!mailbox.ok) return { ok: false, reason: mailbox.reason };

  const token = attempt.threadToken ?? newThreadToken();
  const body = buildBody(attempt.messageSnapshot, attempt.listing);

  try {
    const transport = nodemailer.createTransport({
      host: mailbox.credentials.smtpHost,
      port: mailbox.credentials.smtpPort,
      secure: mailbox.credentials.smtpSecure,
      auth: { user: mailbox.credentials.user, pass: mailbox.credentials.password },
    });
    const info = await transport.sendMail({
      from: { name: settings.fromName, address: settings.fromAddress },
      to: target,
      replyTo: replyToWithToken(settings.fromAddress, token),
      subject: fillSubject(settings.subjectTemplate, attempt.listing),
      text: body,
    });

    await prisma.contactAttempt.update({
      where: { id: contactAttemptId },
      data: {
        deliveryStatus: 'SENT',
        deliveryError: null,
        threadToken: token,
        outboundMessageId: info.messageId ?? null,
      },
    });
    await prisma.candidateListingMatch.updateMany({
      where: { candidateCaseId: attempt.candidateCaseId, listingId: attempt.listingId },
      data: { status: 'CONTACTED' },
    });
    await prisma.contactMessage.create({
      data: {
        contactAttemptId,
        direction: 'OUTGOING',
        body,
        recordedById: userId,
        externalId: info.messageId ?? null,
        readAt: new Date(),
      },
    });
    await scheduleReplyCheck(contactAttemptId);
    return { ok: true };
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    await prisma.contactAttempt.update({
      where: { id: contactAttemptId },
      data: { deliveryStatus: 'FAILED', deliveryError: message },
    });
    return { ok: false, reason: `Versand fehlgeschlagen: ${message}` };
  }
}

/** Verifies the mailbox without sending anything to a landlord. */
/**
 * Checks a mailbox the way it is actually used: sending *and* receiving.
 *
 * Only SMTP was checked before, which is half the story — the app's main job
 * with a mailbox is reading replies out of it. A password that sends fine and
 * cannot log into IMAP produced a green light and no answers, and there was
 * nothing on screen to say which half was broken.
 */
export async function verifyMailbox(accountId?: string): Promise<{ ok: boolean; message: string }> {
  const mailbox = await loadMailbox(accountId);
  if (!mailbox.ok) return { ok: false, message: mailbox.reason };
  const c = mailbox.credentials;

  const problems: string[] = [];

  try {
    const transport = nodemailer.createTransport({
      host: c.smtpHost,
      port: c.smtpPort,
      secure: c.smtpSecure,
      auth: { user: c.user, pass: c.password },
    });
    await transport.verify();
  } catch (err) {
    problems.push(`Senden (SMTP ${c.smtpHost}): ${(err as Error).message.slice(0, 160)}`);
  }

  try {
    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow({
      host: c.imapHost,
      port: c.imapPort,
      secure: c.imapSecure,
      auth: { user: c.user, pass: c.imapPassword },
      logger: false,
    });
    await client.connect();
    await client.logout().catch(() => undefined);
  } catch (err) {
    problems.push(`Empfangen (IMAP ${c.imapHost}): ${(err as Error).message.slice(0, 160)}`);
  }

  if (problems.length > 0) {
    const message = problems.join(' · ');
    await markAccountStatus(c.accountId, 'FAILED', message);
    return { ok: false, message: `${c.label}: ${message}` };
  }

  await markAccountStatus(c.accountId, 'OK', null);
  return { ok: true, message: `${c.label}: Senden und Empfangen geprüft — beides läuft.` };
}
