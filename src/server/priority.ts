/**
 * Loads the real numbers behind candidate priority.
 *
 * Observed market data is derived live from listings and contact attempts —
 * there are no denormalised counters to drift out of sync. Only the starting
 * estimate per region is stored (MarketRegion).
 */

import { prisma } from '@/lib/prisma';
import {
  computeCandidatePriority,
  computeMarketDifficulty,
  regionKeyFor,
  type MarketDifficulty,
  type PriorityResult,
  type RegionObservation,
} from '@/domain/priority';
import { DEFAULT_REGION_SEED, REGION_SEEDS } from '@/domain/priority/regionSeeds';

/** Idempotently writes the starting estimates. Safe to run on every deploy. */
export async function syncRegionSeeds(): Promise<number> {
  for (const r of REGION_SEEDS) {
    await prisma.marketRegion.upsert({
      where: { key: r.key },
      create: r,
      // Only refresh the label/note; an admin-tuned difficulty is not overwritten.
      update: { label: r.label, seedNote: r.seedNote },
    });
  }
  return REGION_SEEDS.length;
}

export interface CandidatePriorityView extends PriorityResult {
  candidateCaseId: string;
  regionKey: string | null;
  regionLabel: string;
  market: MarketDifficulty;
}

/** Aggregates what we have actually observed, grouped by region key. */
async function loadRegionObservations(): Promise<Map<string, RegionObservation>> {
  const [listings, contacts, runs] = await Promise.all([
    prisma.listing.findMany({
      select: { locationPostal: true, locationCity: true },
    }),
    prisma.contactAttempt.findMany({
      select: {
        outcome: true,
        listing: { select: { locationPostal: true, locationCity: true } },
      },
    }),
    prisma.searchRun.findMany({
      select: {
        candidateCase: {
          select: {
            searchProfile: { select: { workplacePostalCode: true, workplaceCity: true } },
          },
        },
      },
    }),
  ]);

  const map = new Map<string, RegionObservation>();
  const bump = (key: string | null, patch: Partial<RegionObservation>) => {
    if (!key) return;
    const cur =
      map.get(key) ??
      { contactsSent: 0, positiveResponses: 0, listingsImported: 0, searchRuns: 0 };
    map.set(key, {
      contactsSent: cur.contactsSent + (patch.contactsSent ?? 0),
      positiveResponses: cur.positiveResponses + (patch.positiveResponses ?? 0),
      listingsImported: cur.listingsImported + (patch.listingsImported ?? 0),
      searchRuns: cur.searchRuns + (patch.searchRuns ?? 0),
    });
  };

  for (const l of listings) {
    bump(regionKeyFor(l.locationPostal, l.locationCity), { listingsImported: 1 });
  }
  for (const c of contacts) {
    bump(regionKeyFor(c.listing.locationPostal, c.listing.locationCity), {
      contactsSent: 1,
      positiveResponses: c.outcome === 'POSITIVE' ? 1 : 0,
    });
  }
  for (const r of runs) {
    const p = r.candidateCase.searchProfile;
    bump(regionKeyFor(p?.workplacePostalCode ?? null, p?.workplaceCity ?? null), { searchRuns: 1 });
  }
  return map;
}

const EMPTY: RegionObservation = {
  contactsSent: 0,
  positiveResponses: 0,
  listingsImported: 0,
  searchRuns: 0,
};

/**
 * Priority for every active candidate, highest first. Computed on read so it
 * can never be stale; the candidate count in this tool stays small enough that
 * this is cheaper than maintaining cached scores.
 */
export async function loadCandidatePriorities(now = new Date()): Promise<CandidatePriorityView[]> {
  const [cases, regions, observations] = await Promise.all([
    prisma.candidateCase.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        createdAt: true,
        contractSignedAt: true,
        housingSecuredAt: true,
        searchProfile: {
          select: { workplacePostalCode: true, workplaceCity: true, moveInDate: true },
        },
        contactAttempts: { select: { outcome: true } },
      },
    }),
    prisma.marketRegion.findMany(),
    loadRegionObservations(),
  ]);

  const seedByKey = new Map(regions.map((r) => [r.key, r]));

  const views = cases.map((c) => {
    const profile = c.searchProfile;
    const regionKey = regionKeyFor(profile?.workplacePostalCode ?? null, profile?.workplaceCity ?? null);
    const seedRow = regionKey ? seedByKey.get(regionKey) : undefined;
    const observed = (regionKey ? observations.get(regionKey) : undefined) ?? EMPTY;

    const market = computeMarketDifficulty(
      {
        seededDifficulty: seedRow?.seededDifficulty ?? DEFAULT_REGION_SEED.seededDifficulty,
        seedNote: seedRow?.seedNote ?? DEFAULT_REGION_SEED.seedNote,
      },
      observed,
    );

    const priority = computeCandidatePriority({
      // Fall back to case creation when the contract date was not entered.
      searchStartedAt: c.contractSignedAt ?? c.createdAt,
      moveInDate: profile?.moveInDate ?? null,
      contactsSent: c.contactAttempts.length,
      positiveResponses: c.contactAttempts.filter((a) => a.outcome === 'POSITIVE').length,
      settled: c.housingSecuredAt != null,
      market,
      now,
    });

    return {
      ...priority,
      candidateCaseId: c.id,
      regionKey,
      regionLabel: seedRow?.label ?? profile?.workplaceCity ?? 'Unbekannte Region',
      market,
    };
  });

  return views.sort((a, b) => b.score - a.score || a.candidateCaseId.localeCompare(b.candidateCaseId));
}

export async function loadCandidatePriority(
  candidateCaseId: string,
  now = new Date(),
): Promise<CandidatePriorityView | null> {
  const all = await loadCandidatePriorities(now);
  return all.find((v) => v.candidateCaseId === candidateCaseId) ?? null;
}
