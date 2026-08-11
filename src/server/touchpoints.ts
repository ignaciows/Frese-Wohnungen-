/**
 * Every contact with the outside world for one candidate, in one list.
 *
 * The pieces were all recorded already — the enquiry, the reply the mailbox
 * collected, the answer somebody noted down, the viewing in the diary — but
 * each lived on its own screen, in its own card, sorted by conversation. The
 * question a colleague actually asks is chronological: *what has happened, and
 * when?* Nobody could answer it without opening nine cards.
 *
 * Nothing here is entered by hand: every row is derived from something the
 * system already stores.
 */

import { prisma } from '@/lib/prisma';

export type TouchpointKind = 'sent' | 'reply' | 'outcome' | 'appointment' | 'transfer';

export interface Touchpoint {
  id: string;
  kind: TouchpointKind;
  at: Date;
  /** "Anfrage gesendet", "Antwort erhalten" — what happened, in three words. */
  title: string;
  /** The one line worth reading: the first sentence of a reply, the reason. */
  summary: string | null;
  listing: {
    id: string;
    title: string;
    url: string;
    sourceName: string;
    location: string;
  };
  /** Who did it. Null when the system did it on its own. */
  actor: string | null;
  tone: 'neutral' | 'good' | 'bad' | 'wait';
  /** For deep-linking into the conversation that holds the forms. */
  attemptId: string;
  /** Inbound and nobody has opened it. */
  unread?: boolean;
}

/** A reply is worth reading; it is not worth pasting a whole email into a feed. */
function firstLine(body: string, max = 180): string | null {
  const cleaned = body
    .replace(/^>.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

const OUTCOME_TITLE: Record<string, string> = {
  POSITIVE: 'Zusage',
  NEGATIVE: 'Absage',
  NEEDS_INFO: 'Rückfrage — Unterlagen gewünscht',
  AWAITING: 'Wartet auf Antwort',
};

const APPOINTMENT_TITLE: Record<string, string> = {
  VIEWING: 'Besichtigung',
  VIDEO_CALL: 'Videotermin',
  PHONE_CALL: 'Telefontermin',
  HANDOVER: 'Übergabe',
  OTHER: 'Termin',
};

export async function loadTouchpoints(
  candidateCaseId: string,
  limit = 120,
): Promise<Touchpoint[]> {
  const [attempts, appointments] = await Promise.all([
    prisma.contactAttempt.findMany({
      where: { candidateCaseId },
      orderBy: { contactedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        contactedAt: true,
        channel: true,
        sentToAddress: true,
        deliveryStatus: true,
        outcome: true,
        outcomeAt: true,
        outcomeNote: true,
        user: { select: { name: true } },
        outcomeBy: { select: { name: true } },
        listing: {
          select: {
            id: true,
            title: true,
            rawUrl: true,
            locationCity: true,
            locationPostal: true,
            locationRaw: true,
            source: { select: { name: true } },
          },
        },
        messages: {
          orderBy: { occurredAt: 'asc' },
          select: {
            id: true,
            direction: true,
            body: true,
            subject: true,
            fromAddress: true,
            occurredAt: true,
            readAt: true,
            recordedBy: { select: { name: true } },
          },
        },
        systemTransfer: {
          select: { registeredAt: true, registeredBy: { select: { name: true } } },
        },
      },
    }),
    prisma.appointment.findMany({
      where: { candidateCaseId, listingId: { not: null } },
      orderBy: { scheduledAt: 'desc' },
      take: 50,
      select: {
        id: true,
        kind: true,
        scheduledAt: true,
        status: true,
        location: true,
        listingId: true,
        listing: {
          select: {
            id: true,
            title: true,
            rawUrl: true,
            locationCity: true,
            locationPostal: true,
            locationRaw: true,
            source: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const points: Touchpoint[] = [];

  for (const a of attempts) {
    const listing = {
      id: a.listing.id,
      title: a.listing.title,
      url: a.listing.rawUrl,
      sourceName: a.listing.source.name,
      location:
        [a.listing.locationPostal, a.listing.locationCity].filter(Boolean).join(' ') ||
        a.listing.locationRaw ||
        '—',
    };

    // How the enquiry left the building matters: a mail we sent ourselves can
    // be chased, one typed into a portal form cannot.
    points.push({
      id: `sent-${a.id}`,
      kind: 'sent',
      at: a.contactedAt,
      title: 'Anfrage gesendet',
      summary:
        a.deliveryStatus === 'SENT' && a.sentToAddress
          ? `Per E-Mail an ${a.sentToAddress}`
          : a.deliveryStatus === 'FAILED'
            ? 'Versand fehlgeschlagen'
            : 'Über das Formular des Portals',
      listing,
      actor: a.user.name,
      tone: a.deliveryStatus === 'FAILED' ? 'bad' : 'neutral',
      attemptId: a.id,
    });

    for (const m of a.messages) {
      // Our own outgoing copies add nothing the "Anfrage gesendet" row above
      // does not already say.
      if (m.direction !== 'INCOMING') continue;
      points.push({
        id: `msg-${m.id}`,
        kind: 'reply',
        at: m.occurredAt,
        title: m.fromAddress ? `Antwort von ${m.fromAddress}` : 'Antwort erhalten',
        summary: firstLine(m.subject ? `${m.subject} — ${m.body}` : m.body),
        listing,
        actor: m.recordedBy?.name ?? null,
        tone: 'good',
        attemptId: a.id,
        unread: m.readAt == null,
      });
    }

    if (a.outcome !== 'AWAITING' && a.outcomeAt) {
      points.push({
        id: `outcome-${a.id}`,
        kind: 'outcome',
        at: a.outcomeAt,
        title: OUTCOME_TITLE[a.outcome] ?? a.outcome,
        summary: a.outcomeNote ? firstLine(a.outcomeNote) : null,
        listing,
        actor: a.outcomeBy?.name ?? null,
        tone: a.outcome === 'POSITIVE' ? 'good' : a.outcome === 'NEGATIVE' ? 'bad' : 'wait',
        attemptId: a.id,
      });
    }

    if (a.systemTransfer?.registeredAt) {
      points.push({
        id: `transfer-${a.id}`,
        kind: 'transfer',
        at: a.systemTransfer.registeredAt,
        title: 'Ins Firmen-System übertragen',
        summary: null,
        listing,
        actor: a.systemTransfer.registeredBy?.name ?? null,
        tone: 'neutral',
        attemptId: a.id,
      });
    }
  }

  const attemptByListing = new Map(attempts.map((a) => [a.listing.id, a.id]));
  for (const ap of appointments) {
    if (!ap.listing) continue;
    points.push({
      id: `appt-${ap.id}`,
      kind: 'appointment',
      at: ap.scheduledAt,
      title: APPOINTMENT_TITLE[ap.kind] ?? 'Termin',
      summary: ap.location ?? null,
      listing: {
        id: ap.listing.id,
        title: ap.listing.title,
        url: ap.listing.rawUrl,
        sourceName: ap.listing.source.name,
        location:
          [ap.listing.locationPostal, ap.listing.locationCity].filter(Boolean).join(' ') ||
          ap.listing.locationRaw ||
          '—',
      },
      actor: null,
      tone: ap.status === 'DONE_NEGATIVE' || ap.status === 'CANCELLED' ? 'bad' : 'good',
      attemptId: attemptByListing.get(ap.listing.id) ?? '',
    });
  }

  // Newest first — including appointments in the future, which belong at the
  // top because they are the next thing that happens.
  points.sort((a, b) => b.at.getTime() - a.at.getTime());
  return points.slice(0, limit);
}
