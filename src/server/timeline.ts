/**
 * Everything the timeline needs, read once.
 *
 * The rule for what gets a track: something a colleague has decided about.
 * Every flat that was written to, plus the favourites that are next in line —
 * not the whole result pool, which is a list and already has a screen.
 */

import { prisma } from '@/lib/prisma';
import { buildTimeline, type TimelineFlat, type TimelineView } from '@/domain/timeline';

/** More tracks than this and the line stops being readable at a glance. */
const MAX_TRACKS = 8;

export async function loadCandidateTimeline(candidateCaseId: string): Promise<TimelineView | null> {
  const candidate = await prisma.candidateCase.findUnique({
    where: { id: candidateCaseId },
    select: {
      contractSignedAt: true,
      housingSecuredAt: true,
      searchProfile: { select: { moveInDate: true } },
    },
  });
  if (!candidate) return null;

  const listingFields = {
    id: true,
    title: true,
    locationCity: true,
    imageUrl: true,
    effectiveMonthlyCents: true,
    availableFrom: true,
  } as const;

  const [attempts, appointments, favourites] = await Promise.all([
    prisma.contactAttempt.findMany({
      where: { candidateCaseId },
      orderBy: { contactedAt: 'desc' },
      take: MAX_TRACKS,
      select: {
        contactedAt: true,
        outcome: true,
        outcomeAt: true,
        listing: { select: listingFields },
      },
    }),
    prisma.appointment.findMany({
      where: { candidateCaseId, status: 'SCHEDULED', listingId: { not: null } },
      orderBy: { scheduledAt: 'asc' },
      select: { listingId: true, scheduledAt: true },
    }),
    prisma.candidateListingMatch.findMany({
      where: { candidateCaseId, status: 'FAVORITE' },
      orderBy: { score: 'desc' },
      take: MAX_TRACKS,
      select: { listing: { select: listingFields } },
    }),
  ]);

  // The earliest booked appointment per flat: the next thing in the diary is
  // what the line is about, not the history of cancelled ones.
  const viewingByListing = new Map<string, Date>();
  for (const a of appointments) {
    if (a.listingId && !viewingByListing.has(a.listingId)) {
      viewingByListing.set(a.listingId, a.scheduledAt);
    }
  }

  // The case says a flat was secured but not which one; the most recent
  // acceptance is the only honest candidate for it.
  const securedListingId = candidate.housingSecuredAt
    ? attempts.find((a) => a.outcome === 'POSITIVE')?.listing.id ?? null
    : null;

  const flats: TimelineFlat[] = attempts.map((a) => ({
    id: a.listing.id,
    title: a.listing.title,
    city: a.listing.locationCity,
    imageUrl: a.listing.imageUrl,
    priceCents: a.listing.effectiveMonthlyCents,
    availableFrom: a.listing.availableFrom,
    contactedAt: a.contactedAt,
    repliedAt: a.outcome === 'AWAITING' ? null : a.outcomeAt,
    outcome: a.outcome,
    viewingAt: viewingByListing.get(a.listing.id) ?? null,
    secured: a.listing.id === securedListingId,
  }));

  // Favourites nobody has written to yet, so the line also shows what is queued
  // up rather than only what is already in flight.
  const contactedIds = new Set(flats.map((f) => f.id));
  for (const f of favourites) {
    if (flats.length >= MAX_TRACKS) break;
    if (contactedIds.has(f.listing.id)) continue;
    flats.push({
      id: f.listing.id,
      title: f.listing.title,
      city: f.listing.locationCity,
      imageUrl: f.listing.imageUrl,
      priceCents: f.listing.effectiveMonthlyCents,
      availableFrom: f.listing.availableFrom,
      contactedAt: null,
      repliedAt: null,
      outcome: 'AWAITING',
      viewingAt: null,
      secured: false,
    });
  }

  return buildTimeline({
    now: new Date(),
    contractSignedAt: candidate.contractSignedAt,
    arrival: candidate.searchProfile?.moveInDate ?? null,
    housingSecuredAt: candidate.housingSecuredAt,
    flats: flats.slice(0, MAX_TRACKS),
  });
}
