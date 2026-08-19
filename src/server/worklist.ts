/**
 * Die Datenbank-Seite der Tagesliste aus `domain/worklist`.
 *
 * Drei Abfragen für alle Fälle zusammen, nicht drei pro Fall: die Liste steht
 * auf einem Bildschirm, den jemand morgens als erstes öffnet, und das ist der
 * schlechteste Ort für fünfzig Roundtrips.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildWorklist, type CaseWork, type Worklist } from '@/domain/worklist';
import { loadCandidatePriorities } from './priority';
import { liveListingFilter } from './listingFilters';
import { getLivenessSettings } from './settings';

/**
 * Was heute ansteht, je Fall.
 *
 * „Offen" heißt: passt zum Profil, niemand hat sie abgelehnt, die Anzeige lebt
 * noch, und es ist noch keine Anfrage raus. Genau das, was jemand heute
 * anfassen könnte.
 */
export async function dailyWorklist(now = new Date()): Promise<Worklist> {
  const [cases, priorities, liveness] = await Promise.all([
    prisma.candidateCase.findMany({
      where: { status: 'ACTIVE', housingSecuredAt: null },
      select: {
        id: true,
        displayName: true,
        searchProfile: { select: { employer: true } },
      },
    }),
    loadCandidatePriorities(now),
    getLivenessSettings(),
  ]);
  if (cases.length === 0) return buildWorklist([]);

  const ids = cases.map((c) => c.id);
  const open: Prisma.CandidateListingMatchWhereInput = {
    candidateCaseId: { in: ids },
    status: { in: ['NEW', 'FAVORITE'] },
    compatibility: { in: ['COMPATIBLE', 'NEAR_MATCH'] },
  };

  // Zweimal dieselbe Frage, einmal mit und einmal ohne Nummer. Zwei Zählungen
  // sind hier ehrlicher als eine Gruppierung über ein Feld, das es so nicht
  // gibt — und beide laufen über denselben Index.
  const [withPhone, all] = await Promise.all([
    prisma.candidateListingMatch.groupBy({
      by: ['candidateCaseId'],
      where: { ...open, listing: { ...liveListingFilter(liveness), contactPhone: { not: null } } },
      _count: { _all: true },
    }),
    prisma.candidateListingMatch.groupBy({
      by: ['candidateCaseId'],
      where: { ...open, listing: liveListingFilter(liveness) },
      _count: { _all: true },
    }),
  ]);

  const callableBy = new Map(withPhone.map((r) => [r.candidateCaseId, r._count._all]));
  const openBy = new Map(all.map((r) => [r.candidateCaseId, r._count._all]));
  const priorityBy = new Map(priorities.map((p) => [p.candidateCaseId, p]));

  const work: CaseWork[] = cases.map((c) => {
    const p = priorityBy.get(c.id);
    const callable = callableBy.get(c.id) ?? 0;
    return {
      candidateCaseId: c.id,
      displayName: c.displayName,
      employer: c.searchProfile?.employer ?? null,
      priorityScore: p?.score ?? 0,
      tier: p?.tier ?? 'NORMAL',
      daysUntilMoveIn: p?.daysUntilMoveIn ?? null,
      remainingContacts: p?.remainingContacts ?? 0,
      callable,
      writable: Math.max(0, (openBy.get(c.id) ?? 0) - callable),
    };
  });

  return buildWorklist(work);
}
