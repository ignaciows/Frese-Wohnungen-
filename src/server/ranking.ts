/**
 * Persist candidate/listing rankings. Called after ingest and after profile
 * changes. Each Listing gets one CandidateListingMatch per active candidate.
 */

import { prisma } from '@/lib/prisma';
import { rank, type RankingListing, type RankingProfile } from '@/domain/ranking';
import { haversineKm, estimateCommuteMinutes } from '@/lib/distance';
import { isPlausibleHousing, type PlausibilityLimits } from '@/domain/discovery/plausible';
import { getQualitySettings } from './settings';

/**
 * The exclusion rules, read once per recompute.
 *
 * They live in the settings so a colleague can move them; they are applied
 * here, at ranking time, so they also catch everything already in the pool
 * rather than only what arrives next.
 */
async function qualityLimits(): Promise<PlausibilityLimits> {
  const q = await getQualitySettings();
  return {
    minMonthlyCents: Math.round(q.minMonthlyEuros * 100),
    maxMonthlyCents: Math.round(q.maxMonthlyEuros * 100),
    maxRooms: q.maxRooms,
    minSqm: q.minSqm,
    rejectShortStay: q.rejectShortStay,
  };
}

function disqualifyingReason(
  l: { title: string; descriptionRaw: string; effectiveMonthlyCents: number | null; kaltMieteCents: number | null; warmMieteCents: number | null; rooms: number | null; livingSpaceSqm: number | null },
  limits: PlausibilityLimits,
): string | null {
  const verdict = isPlausibleHousing(
    {
      title: l.title,
      description: l.descriptionRaw,
      structured: {
        warmMieteCents: l.warmMieteCents ?? l.effectiveMonthlyCents,
        kaltMieteCents: l.kaltMieteCents,
        rooms: l.rooms,
        livingSpaceSqm: l.livingSpaceSqm,
      },
    },
    limits,
  );
  return verdict.plausible ? null : verdict.reason;
}

function toRankingListing(
  l: Awaited<ReturnType<typeof loadListing>>,
  profile: RankingProfile,
  limits: PlausibilityLimits = {},
): RankingListing {
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
    // Read even when a distance exists: the postcode check only runs as a
    // fallback, but carrying the values costs nothing and keeps the two paths
    // from disagreeing about what a listing's location is.
    locationPostal: l.locationPostal,
    locationCity: l.locationCity,
    availableFrom: l.availableFrom,
    // Judged by the source's category, not by the advert's wording: a
    // Wunderflats listing reads exactly like a normal flat and is let by the
    // month with no move-in date. See RankingListing.shortStayProvider.
    shortStayProvider: SHORT_STAY_CATEGORIES.has(l.source?.category ?? ''),
    disqualified: disqualifyingReason(l, limits),
  };
}

/**
 * Categories whose whole inventory is temporary accommodation.
 *
 * FURNISHED covers Wunderflats, HousingAnywhere and Spotahome; TEMPORARY
 * covers Monteurzimmer and Boardinghouses. Nothing on either is a flat somebody
 * signs a lease for, which is what these cases need.
 */
const SHORT_STAY_CATEGORIES = new Set(['FURNISHED', 'TEMPORARY']);

async function loadListing(id: string) {
  return prisma.listing.findUniqueOrThrow({
    where: { id },
    include: { source: { select: { category: true } } },
  });
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
  workplacePostalCode?: string | null;
  workplaceCity?: string | null;
  moveInDate?: Date | null;
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
    workplacePostalCode: p.workplacePostalCode ?? null,
    workplaceCity: p.workplaceCity ?? null,
    moveInDate: p.moveInDate ?? null,
  };
}

export async function computeMatchesForListing(listingId: string): Promise<void> {
  const listing = await loadListing(listingId);
  const limits = await qualityLimits();
  const cases = await prisma.candidateCase.findMany({
    where: { status: 'ACTIVE' },
    include: { searchProfile: true },
  });
  for (const c of cases) {
    if (!c.searchProfile) continue;
    const profile = profileFromDb(c.searchProfile);
    const result = rank(toRankingListing(listing, profile, limits), profile);
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
  const limits = await qualityLimits();
  const listings = await prisma.listing.findMany({
    include: { source: { select: { category: true } } },
  });
  for (const l of listings) {
    const result = rank(toRankingListing(l, profile, limits), profile);
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
