/**
 * Die Datenbank-Seite der zwei Auswertungen aus `domain/insights`.
 *
 * Hier steht nur das Holen; gerechnet wird drüben, damit die Regeln ohne
 * Datenbank prüfbar bleiben.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  findStalledCases,
  responseRates,
  type CaseActivity,
  type StalledCase,
  type StalledSettings,
} from '@/domain/insights';
import { liveListingFilter } from './listingFilters';

/**
 * Fälle, für die gerade nichts nachkommt.
 *
 * „Brauchbar" heißt: die Wohnung lebt noch, sie passt zum Profil, und niemand
 * hat sie abgelehnt. Genau das, was jemand heute anschreiben könnte.
 */
export async function stalledCases(
  now = new Date(),
  settings?: StalledSettings,
): Promise<StalledCase[]> {
  const cases = await prisma.candidateCase.findMany({
    where: { status: 'ACTIVE', housingSecuredAt: null },
    select: {
      id: true,
      displayName: true,
      searchProfile: { select: { moveInDate: true } },
    },
  });
  if (cases.length === 0) return [];

  const usableFilter: Prisma.CandidateListingMatchWhereInput = {
    compatibility: { in: ['COMPATIBLE', 'NEAR_MATCH'] },
    listing: liveListingFilter(),
  };

  const activity: CaseActivity[] = await Promise.all(
    cases.map(async (c) => {
      const [usableNow, newest] = await Promise.all([
        prisma.candidateListingMatch.count({
          where: { candidateCaseId: c.id, status: { in: ['NEW', 'FAVORITE'] }, ...usableFilter },
        }),
        // Der jüngste brauchbare Treffer überhaupt — auch ein längst
        // angeschriebener zählt: er beweist, dass die Suche etwas hergibt.
        // `computedAt` und nicht das Datum der Anzeige: gefragt ist, wann
        // dieser Fall zuletzt etwas Anschreibbares *bekommen* hat.
        prisma.candidateListingMatch.findFirst({
          where: { candidateCaseId: c.id, ...usableFilter },
          orderBy: { computedAt: 'desc' },
          select: { computedAt: true },
        }),
      ]);
      return {
        candidateCaseId: c.id,
        displayName: c.displayName,
        usableNow,
        lastUsableAt: newest?.computedAt ?? null,
        moveInDate: c.searchProfile?.moveInDate ?? null,
      };
    }),
  );

  return findStalledCases(activity, now, settings);
}

/**
 * Antwortquote je Quelle und insgesamt.
 *
 * Nur Anfragen, die alt genug sind, um eine Antwort haben zu können — sonst
 * drückt jede heute verschickte Anfrage die Quote, und die Zahl sagt mehr über
 * den Vormittag als über das Anschreiben.
 */
export async function responseStats(options: { ripeAfterDays?: number } = {}) {
  const ripeAfterDays = options.ripeAfterDays ?? 3;
  const cutoff = new Date(Date.now() - ripeAfterDays * 86_400_000);

  const attempts = await prisma.contactAttempt.findMany({
    where: { contactedAt: { lte: cutoff } },
    select: {
      outcome: true,
      contactedAt: true,
      listing: { select: { source: { select: { name: true } } } },
    },
  });

  return responseRates(
    attempts.map((a) => ({
      sourceName: a.listing.source.name,
      outcome: a.outcome,
      contactedAt: a.contactedAt,
    })),
  );
}
