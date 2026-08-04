/**
 * Persist candidate/listing rankings. Called after ingest and after profile
 * changes. Each Listing gets one CandidateListingMatch per active candidate.
 */

import { prisma } from '@/lib/prisma';
import { rank, type RankingListing, type RankingProfile } from '@/domain/ranking';
import { haversineKm, estimateCommuteMinutes } from '@/lib/distance';

function toRankingListing(l: Awaited<ReturnType<typeof loadListing>>, profile: RankingProfile): RankingListing {
  let distanceKm: number | null = null;
  let commuteMinutes: number | null = null;
  if (
    profile.workplaceLat != null &&
    profile.workplaceLon != null &&
    l.lat != null &&
    l.lon != null
  ) {
    distanceKm = Math.round(haversineKm({ lat: profile.workplaceLat, lon: profile.workplaceLon }, { lat: l.lat, lon: l.lon }) * 10) / 10;
    commuteMinutes = estimateCommuteMinutes(distanceKm, 'CAR');
  }
  return {
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
}

async function loadListing(id: string) {
  const l = await prisma.listing.findUniqueOrThrow({ where: { id } });
  return l;
}

function profileFromDb(p: {
  workplaceLat: number | null;
  workplaceLon: number | null;
  maxWarmmieteCents: number;
  maxCommuteMinutes: number | null;
  radiusKm: number | null;
  adults: number;
  children: number;
  minRooms: number;
  preferredRooms: number;
  furnished: 'REQUIRED' | 'PREFERRED' | 'EITHER';
  wbsStatus: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
  temporaryMode: boolean;
}): RankingProfile {
  return {
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
}

export async function computeMatchesForListing(listingId: string): Promise<void> {
  const listing = await loadListing(listingId);
  const cases = await prisma.candidateCase.findMany({
    where: { status: 'ACTIVE' },
    include: { searchProfile: true },
  });
  for (const c of cases) {
    if (!c.searchProfile) continue;
    const profile = profileFromDb(c.searchProfile);
    const result = rank(toRankingListing(listing, profile), profile);
    await prisma.candidateListingMatch.upsert({
      where: {
        candidateCaseId_listingId: { candidateCaseId: c.id, listingId: listing.id },
      },
      create: {
        candidateCaseId: c.id,
        listingId: listing.id,
        compatibility: result.compatibility,
        score: result.score,
        breakdown: result.breakdown as unknown as object,
        reasons: result.reasons as unknown as object,
        blockers: result.blockers as unknown as object,
        rankVersion: result.rankVersion,
      },
      update: {
        compatibility: result.compatibility,
        score: result.score,
        breakdown: result.breakdown as unknown as object,
        reasons: result.reasons as unknown as object,
        blockers: result.blockers as unknown as object,
        rankVersion: result.rankVersion,
        computedAt: new Date(),
      },
    });
  }
}

export async function recomputeAllForCandidate(candidateCaseId: string): Promise<void> {
  const candidate = await prisma.candidateCase.findUniqueOrThrow({
    where: { id: candidateCaseId },
    include: { searchProfile: true },
  });
  if (!candidate.searchProfile) return;
  const profile = profileFromDb(candidate.searchProfile);
  const listings = await prisma.listing.findMany();
  for (const l of listings) {
    const result = rank(toRankingListing(l, profile), profile);
    await prisma.candidateListingMatch.upsert({
      where: {
        candidateCaseId_listingId: { candidateCaseId: candidate.id, listingId: l.id },
      },
      create: {
        candidateCaseId: candidate.id,
        listingId: l.id,
        compatibility: result.compatibility,
        score: result.score,
        breakdown: result.breakdown as unknown as object,
        reasons: result.reasons as unknown as object,
        blockers: result.blockers as unknown as object,
        rankVersion: result.rankVersion,
      },
      update: {
        compatibility: result.compatibility,
        score: result.score,
        breakdown: result.breakdown as unknown as object,
        reasons: result.reasons as unknown as object,
        blockers: result.blockers as unknown as object,
        rankVersion: result.rankVersion,
        computedAt: new Date(),
      },
    });
  }
}
