/**
 * Why a candidate's working list is empty.
 *
 * "Nothing found" leaves open whether the search ran at all, whether it ran
 * anywhere useful, and whether the criteria or the market are at fault — and
 * those need opposite reactions. Two facts settle it: where we looked and what
 * each place returned, and the smallest change that would actually produce
 * flats, measured against the adverts already held rather than promised in the
 * abstract.
 */

import { prisma } from '@/lib/prisma';

export interface EmptyListExplanation {
  searched: Array<{ name: string; found: number; note: string | null; at: Date | null }>;
  suggestions: Array<{ key: string; label: string; gained: number }>;
}

export async function explainEmptyList(candidateCaseId: string): Promise<EmptyListExplanation> {
  const [searched, suggestions] = await Promise.all([
    lastRunPerSource(),
    relaxationsFor(candidateCaseId),
  ]);
  return { searched, suggestions };
}

/**
 * The newest run per source. Older runs of the same source say nothing extra —
 * a list repeating "Kleinanzeigen" six times is a log, not an answer.
 */
async function lastRunPerSource(): Promise<EmptyListExplanation['searched']> {
  const runs = await prisma.discoveryRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 40,
    select: {
      found: true,
      message: true,
      startedAt: true,
      source: { select: { name: true } },
    },
  });

  const newest = new Map<string, EmptyListExplanation['searched'][number]>();
  for (const r of runs) {
    if (newest.has(r.source.name)) continue;
    newest.set(r.source.name, {
      name: r.source.name,
      found: r.found,
      note: r.message,
      at: r.startedAt,
    });
  }
  return [...newest.values()];
}

/** The changes that would unlock flats we already hold, best first. */
async function relaxationsFor(candidateCaseId: string): Promise<EmptyListExplanation['suggestions']> {
  try {
    const { loadSimulationInputs } = await import('./whatif');
    const { suggestRelaxations } = await import('@/domain/whatif');
    const { listings, profile } = await loadSimulationInputs(candidateCaseId);
    return suggestRelaxations(listings, profile)
      .filter((r) => r.gained > 0)
      .slice(0, 4)
      .map((r) => ({ key: r.key, label: r.label, gained: r.gained }));
  } catch {
    // An explanation that cannot be produced must never take the page with it.
    return [];
  }
}
