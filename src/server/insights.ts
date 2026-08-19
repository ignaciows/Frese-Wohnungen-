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
import { getLivenessSettings } from './settings';

/** Passt zum Profil und hat niemand abgelehnt — unabhängig davon, ob die
 *  Anzeige heute noch online ist. */
const COMPATIBLE: Prisma.CandidateListingMatchWhereInput = {
  compatibility: { in: ['COMPATIBLE', 'NEAR_MATCH'] },
};

/**
 * Fälle, für die gerade nichts nachkommt.
 *
 * Zwei Zahlen je Fall, und für jede genau eine Abfrage über alle Fälle
 * zusammen — vorher war es eine Abfrage pro Fall, was bei fünfzig Fällen
 * hundert Roundtrips für einen Bildschirm bedeutete.
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

  const ids = cases.map((c) => c.id);
  const liveness = await getLivenessSettings();

  const [open, newest] = await Promise.all([
    // Was jemand heute anschreiben könnte: passt, ist offen, und die Anzeige
    // lebt noch. Hier gehört die Lebendprüfung hin — eine tote Anzeige ist
    // keine offene Aufgabe.
    prisma.candidateListingMatch.groupBy({
      by: ['candidateCaseId'],
      where: {
        candidateCaseId: { in: ids },
        status: { in: ['NEW', 'FAVORITE'] },
        listing: liveListingFilter(liveness),
        ...COMPATIBLE,
      },
      _count: { _all: true },
    }),
    // Wann zuletzt überhaupt etwas Passendes dazukam — bewusst ohne
    // Lebendprüfung. Sonst verschwindet mit jeder ablaufenden Anzeige auch der
    // Beleg dafür, dass die Suche mal etwas hergegeben hat, und ein gut
    // laufender Fall meldet sich irgendwann als „noch nie ein Treffer".
    prisma.candidateListingMatch.groupBy({
      by: ['candidateCaseId'],
      where: { candidateCaseId: { in: ids }, ...COMPATIBLE },
      _max: { matchedAt: true },
    }),
  ]);

  const openByCase = new Map(open.map((r) => [r.candidateCaseId, r._count._all]));
  const newestByCase = new Map(newest.map((r) => [r.candidateCaseId, r._max.matchedAt]));

  const activity: CaseActivity[] = cases.map((c) => ({
    candidateCaseId: c.id,
    displayName: c.displayName,
    usableNow: openByCase.get(c.id) ?? 0,
    lastUsableAt: newestByCase.get(c.id) ?? null,
    moveInDate: c.searchProfile?.moveInDate ?? null,
  }));

  return findStalledCases(activity, now, settings);
}

/**
 * Antwortquote je Quelle und insgesamt.
 *
 * Zwei Grenzen, beide absichtlich:
 *
 * - **Nach unten:** nur Anfragen, die alt genug sind, um eine Antwort haben zu
 *   können. Sonst drückt jede heute verschickte Anfrage die Quote, und die
 *   Zahl sagt mehr über den Vormittag als über das Anschreiben.
 * - **Nach oben:** nur die letzten Monate. Ein Anschreiben, das vor einem Jahr
 *   schlecht lief, sagt nichts über das von heute — und je länger die App
 *   läuft, desto träger würde die Quote auf jede Änderung reagieren.
 */
export async function responseStats(
  options: { ripeAfterDays?: number; windowDays?: number } = {},
) {
  const ripeAfterDays = options.ripeAfterDays ?? 3;
  const windowDays = options.windowDays ?? 180;
  const ripe = new Date(Date.now() - ripeAfterDays * 86_400_000);
  const oldest = new Date(Date.now() - windowDays * 86_400_000);

  const attempts = await prisma.contactAttempt.findMany({
    where: { contactedAt: { lte: ripe, gte: oldest } },
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
