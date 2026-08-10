/**
 * Loads the inputs the what-if simulator needs: every listing already imported
 * for this candidate, in the same shape the ranking engine consumes, plus the
 * saved profile. Nothing here writes.
 */

import { prisma } from '@/lib/prisma';
import type { RankingListing, RankingProfile } from '@/domain/ranking';
import { haversineKm, estimateCommuteMinutes } from '@/lib/distance';
import { LIVE_LISTING } from './listingFilters';

/**
 * A ranking input that still knows which ad it came from, so the simulator can
 * show *which* flats a loosened criterion would unlock rather than only how
 * many.
 */
export interface IdentifiedListing extends RankingListing {
  id: string;
  title: string;
  city: string | null;
  url: string;
  monthlyCents: number | null;
  roomCount: number | null;
  sourceName: string;
  status: string;
}

export async function loadSimulationInputs(candidateCaseId: string): Promise<{
  listings: IdentifiedListing[];
  profile: RankingProfile;
}> {
  const [p, matches] = await Promise.all([
    prisma.searchProfile.findUniqueOrThrow({ where: { candidateCaseId } }),
    prisma.candidateListingMatch.findMany({
      where: {
        candidateCaseId,
        // Simulating against dead ads would promise results that do not exist.
        listing: LIVE_LISTING,
      },
      include: { listing: { include: { source: { select: { name: true } } } } },
    }),
  ]);

  const profile: RankingProfile = {
    workplaceLat: p.workplaceLat,
    workplaceLon: p.workplaceLon,
    maxWarmmieteCents: p.maxWarmmieteCents,
    maxCommuteMinutes: p.maxCommuteMinutes,
    radiusKm: p.radiusKm,
    adults: p.adults,
    children: p.children,
    minRooms: p.minRooms,
    preferredRooms: p.preferredRooms,
    furnished: p.furnished,
    wbsStatus: p.wbsStatus,
    temporaryMode: p.temporaryMode,
  };

  const listings: IdentifiedListing[] = matches.map(({ listing: l, status }) => {
    let distanceKm: number | null = null;
    let commuteMinutes: number | null = null;
    if (p.workplaceLat != null && p.workplaceLon != null && l.lat != null && l.lon != null) {
      distanceKm =
        Math.round(
          haversineKm({ lat: p.workplaceLat, lon: p.workplaceLon }, { lat: l.lat, lon: l.lon }) * 10,
        ) / 10;
      commuteMinutes = estimateCommuteMinutes(distanceKm, 'CAR');
    }
    return {
      id: l.id,
      title: l.title,
      city: l.locationCity,
      url: l.canonicalUrl,
      monthlyCents: l.effectiveMonthlyCents,
      roomCount: l.rooms,
      sourceName: l.source.name,
      status,
      propertyType: l.propertyType,
      furnishing: l.furnishing,
      fittedKitchen: l.fittedKitchen,
      effectiveMonthlyCents: l.effectiveMonthlyCents,
      monthlyTotalComplete: l.monthlyTotalComplete,
      kaltMieteCents: l.kaltMieteCents,
      rooms: l.rooms,
      wbsRequired: l.wbsRequired,
      exchangeRequired: l.exchangeRequired,
      petsAllowed: l.petsAllowed,
      fixedTerm: l.fixedTerm,
      distanceKm,
      commuteMinutes,
    };
  });

  return { listings, profile };
}
