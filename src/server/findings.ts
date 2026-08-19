/**
 * Nach einem Suchlauf: wer hat etwas bekommen, und wird darüber gemeldet.
 *
 * Läuft am Ende jedes Suchlaufs. Die Regeln, was überhaupt eine Meldung wert
 * ist, stehen in `domain/findings` und sind ohne Datenbank prüfbar; hier steht
 * nur, wie man die Zahlen bekommt.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { findingsToNotices, type CandidateFindings } from '@/domain/findings';
import { notify } from './followUps';
import { USABLE_COMPATIBILITY, liveListingFilter } from './listingFilters';
import { getLivenessSettings } from './settings';

/**
 * Meldet neue anschreibbare Wohnungen je Fall.
 *
 * `since` ist der Beginn des Suchlaufs. Gezählt wird über `matchedAt` — wann
 * ein Treffer für diesen Fall entstanden ist — und nicht über das Alter der
 * Anzeige: eine Anzeige von letzter Woche, die erst heute zu diesem Profil
 * passt, ist für diesen Fall neu.
 *
 * Gibt zurück, wie viele Meldungen geschrieben wurden.
 */
export async function notifyNewFindings(since: Date): Promise<number> {
  const liveness = await getLivenessSettings();

  const fresh: Prisma.CandidateListingMatchWhereInput = {
    matchedAt: { gte: since },
    status: 'NEW',
    compatibility: USABLE_COMPATIBILITY,
    candidateCase: { status: 'ACTIVE', housingSecuredAt: null },
  };

  // Zwei Zählungen über alle Fälle: dieselbe Frage einmal mit und einmal ohne
  // Telefonnummer. Ein Suchlauf berührt jeden aktiven Fall, und je Fall zu
  // zählen hieße hier hundert Abfragen für eine Handvoll Meldungen.
  const [added, withPhone] = await Promise.all([
    prisma.candidateListingMatch.groupBy({
      by: ['candidateCaseId'],
      where: { ...fresh, listing: liveListingFilter(liveness) },
      _count: { _all: true },
    }),
    prisma.candidateListingMatch.groupBy({
      by: ['candidateCaseId'],
      where: {
        ...fresh,
        listing: { ...liveListingFilter(liveness), contactPhone: { not: null } },
      },
      _count: { _all: true },
    }),
  ]);
  if (added.length === 0) return 0;

  const phoneBy = new Map(withPhone.map((r) => [r.candidateCaseId, r._count._all]));
  const names = await prisma.candidateCase.findMany({
    where: { id: { in: added.map((r) => r.candidateCaseId) } },
    select: { id: true, displayName: true },
  });
  const nameBy = new Map(names.map((c) => [c.id, c.displayName]));

  const findings: CandidateFindings[] = added.map((r) => ({
    candidateCaseId: r.candidateCaseId,
    displayName: nameBy.get(r.candidateCaseId) ?? 'Unbekannter Fall',
    added: r._count._all,
    withPhone: phoneBy.get(r.candidateCaseId) ?? 0,
  }));

  const notices = findingsToNotices(findings);
  for (const n of notices) {
    await notify({
      kind: 'DISCOVERY_RESULT',
      title: n.title,
      body: n.body,
      url: n.url,
      candidateCaseId: n.candidateCaseId,
    });
  }
  return notices.length;
}
