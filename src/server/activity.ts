/**
 * Touchpoints and weekly activity.
 *
 * A touchpoint is any real interaction on a case: an Anfrage, a logged
 * message, a landlord's answer, a scheduled or held appointment. The timeline
 * is derived from the existing records rather than being written twice, so it
 * can never disagree with the underlying history.
 *
 * Weekly summaries ARE stored, because they are the thing someone wants to
 * look back on months later ("how many Anfragen did we send that week?").
 * They are recomputed idempotently from the same records.
 */

import { prisma } from '@/lib/prisma';

export type TouchpointKind =
  | 'ANFRAGE'
  | 'REPLY_POSITIVE'
  | 'REPLY_NEGATIVE'
  | 'REPLY_INFO'
  | 'MESSAGE_OUT'
  | 'MESSAGE_IN'
  | 'APPOINTMENT'
  | 'LISTING_IMPORTED'
  | 'SOURCE_CHECKED';

export interface Touchpoint {
  at: Date;
  kind: TouchpointKind;
  title: string;
  detail?: string | null;
  who?: string | null;
  href?: string | null;
}

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStartOf(d: Date): Date {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (utc.getUTCDay() + 6) % 7; // Monday = 0
  utc.setUTCDate(utc.getUTCDate() - dow);
  return utc;
}

export function weekLabel(weekStart: Date): string {
  const end = new Date(weekStart.getTime() + 6 * 86_400_000);
  const f = (x: Date) => x.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  return `${f(weekStart)} – ${f(end)}`;
}

export async function loadTouchpoints(candidateCaseId: string, limit = 200): Promise<Touchpoint[]> {
  const [attempts, messages, appointments, listings, checks] = await Promise.all([
    prisma.contactAttempt.findMany({
      where: { candidateCaseId },
      include: { listing: { select: { title: true } }, user: { select: { name: true } } },
    }),
    prisma.contactMessage.findMany({
      where: { contactAttempt: { candidateCaseId } },
      include: {
        recordedBy: { select: { name: true } },
        contactAttempt: { include: { listing: { select: { title: true } } } },
      },
    }),
    prisma.appointment.findMany({
      where: { candidateCaseId },
      include: { listing: { select: { title: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.candidateListingMatch.findMany({
      where: { candidateCaseId },
      include: { listing: { select: { title: true, importedAt: true, source: { select: { name: true } } } } },
    }),
    prisma.sourceCheck.findMany({
      where: { searchRun: { candidateCaseId }, lastCheckedAt: { not: null } },
      include: { source: { select: { name: true } }, checkedBy: { select: { name: true } } },
    }),
  ]);

  const out: Touchpoint[] = [];

  for (const a of attempts) {
    out.push({
      at: a.contactedAt,
      kind: 'ANFRAGE',
      title: `Anfrage gesendet — ${a.listing.title}`,
      who: a.user.name,
    });
    if (a.outcomeAt) {
      out.push({
        at: a.outcomeAt,
        kind:
          a.outcome === 'POSITIVE'
            ? 'REPLY_POSITIVE'
            : a.outcome === 'NEGATIVE'
              ? 'REPLY_NEGATIVE'
              : 'REPLY_INFO',
        title:
          a.outcome === 'POSITIVE'
            ? `Positive Rückmeldung — ${a.listing.title}`
            : a.outcome === 'NEGATIVE'
              ? `Absage — ${a.listing.title}`
              : `Unterlagen angefragt — ${a.listing.title}`,
        detail: a.outcomeNote,
      });
    }
  }

  for (const m of messages) {
    out.push({
      at: m.occurredAt,
      kind: m.direction === 'OUTGOING' ? 'MESSAGE_OUT' : 'MESSAGE_IN',
      title:
        (m.direction === 'OUTGOING' ? 'Nachricht von uns' : 'Nachricht vom Vermieter') +
        ` — ${m.contactAttempt.listing.title}`,
      detail: m.body.slice(0, 160),
      who: m.recordedBy.name,
    });
  }

  for (const ap of appointments) {
    out.push({
      at: ap.scheduledAt,
      kind: 'APPOINTMENT',
      title: `Termin (${ap.kind})${ap.listing ? ` — ${ap.listing.title}` : ''}`,
      detail: ap.status === 'SCHEDULED' ? 'geplant' : ap.status,
      who: ap.createdBy.name,
    });
  }

  for (const m of listings) {
    out.push({
      at: m.listing.importedAt,
      kind: 'LISTING_IMPORTED',
      title: `Anzeige importiert — ${m.listing.title}`,
      detail: m.listing.source.name,
    });
  }

  for (const c of checks) {
    out.push({
      at: c.lastCheckedAt!,
      kind: 'SOURCE_CHECKED',
      title: `Quelle geprüft — ${c.source.name}`,
      detail: c.status,
      who: c.checkedBy?.name ?? null,
    });
  }

  return out.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/**
 * Recomputes and stores weekly rows for a candidate. Idempotent: the unique
 * (case, weekStart) key means re-running only refreshes the numbers.
 */
export async function rebuildWeeklySummaries(candidateCaseId: string, weeks = 12): Promise<number> {
  const now = new Date();
  const currentWeek = weekStartOf(now);
  const oldest = new Date(currentWeek.getTime() - (weeks - 1) * 7 * 86_400_000);

  const touchpoints = await loadTouchpoints(candidateCaseId, 5000);
  const attempts = await prisma.contactAttempt.findMany({
    where: { candidateCaseId },
    select: { outcome: true, contactedAt: true },
  });
  const upcoming = await prisma.appointment.count({
    where: { candidateCaseId, status: 'SCHEDULED', scheduledAt: { gte: now } },
  });

  const buckets = new Map<number, ReturnType<typeof emptyBucket>>();
  const bucketFor = (d: Date) => {
    const ws = weekStartOf(d);
    if (ws < oldest) return null;
    const key = ws.getTime();
    if (!buckets.has(key)) buckets.set(key, emptyBucket());
    return buckets.get(key)!;
  };

  for (const t of touchpoints) {
    const b = bucketFor(t.at);
    if (!b) continue;
    if (t.kind === 'ANFRAGE') b.anfragenSent++;
    else if (t.kind === 'REPLY_POSITIVE') b.positiveReplies++;
    else if (t.kind === 'REPLY_NEGATIVE') b.negativeReplies++;
    else if (t.kind === 'LISTING_IMPORTED') b.listingsImported++;
    else if (t.kind === 'SOURCE_CHECKED') b.sourcesChecked++;
    else if (t.kind === 'APPOINTMENT' && t.at <= now) b.appointmentsHeld++;
  }

  // Anfragen still waiting for any answer, counted in the week they were sent.
  for (const a of attempts) {
    if (a.outcome !== 'AWAITING') continue;
    const b = bucketFor(a.contactedAt);
    if (b) b.awaitingReplies++;
  }

  let written = 0;
  for (const [key, b] of buckets) {
    const weekStart = new Date(key);
    await prisma.weeklySummary.upsert({
      where: { candidateCaseId_weekStart: { candidateCaseId, weekStart } },
      create: {
        candidateCaseId,
        weekStart,
        ...b,
        appointmentsAhead: weekStart.getTime() === currentWeek.getTime() ? upcoming : 0,
      },
      update: {
        ...b,
        appointmentsAhead: weekStart.getTime() === currentWeek.getTime() ? upcoming : 0,
        generatedAt: new Date(),
      },
    });
    written++;
  }
  return written;
}

export async function rebuildAllWeeklySummaries(): Promise<number> {
  const cases = await prisma.candidateCase.findMany({ select: { id: true } });
  let total = 0;
  for (const c of cases) total += await rebuildWeeklySummaries(c.id);
  return total;
}

function emptyBucket() {
  return {
    anfragenSent: 0,
    positiveReplies: 0,
    negativeReplies: 0,
    awaitingReplies: 0,
    listingsImported: 0,
    sourcesChecked: 0,
    appointmentsHeld: 0,
  };
}
