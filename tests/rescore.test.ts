/**
 * A fixed rule has to reach the candidates who already exist.
 *
 * Scores are stored. So a change to the ranking reaches only the adverts found
 * *after* it unless something re-scores what is already there — which is worth
 * nothing once there are twenty candidates with a pool each, and is exactly how
 * the metropolitan-postcode fix and the estimated Nebenkosten landed without
 * changing a single verdict in the database.
 *
 * `RANK_VERSION` is the mechanism: every match records the version it was
 * scored under, and a mismatch triggers a recompute when the list is opened.
 * These tests hold that wiring in place, because the failure is silent — the
 * screen looks normal, it is just still answering with last month's rules.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import { RANK_VERSION } from '@/domain/ranking';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

/** A candidate in Cologne with one Cologne flat, scored under an old version. */
async function seedStaleMatch() {
  const { hashPassword } = await import('@/lib/auth');
  const user = await prisma.user.create({
    data: {
      email: 'rescore@test.local',
      name: 'Test',
      role: 'ADMIN',
      passwordHash: await hashPassword('test-pw-1234'),
    },
  });
  const candidate = await prisma.candidateCase.create({
    data: { reference: 'CAND-RS-01', displayName: 'Test', createdById: user.id },
  });
  await prisma.searchProfile.create({
    data: {
      candidateCaseId: candidate.id,
      workplaceAddress: 'Kerpener Str. 62, Köln',
      workplaceCity: 'Köln',
      workplacePostalCode: '50937',
      maxWarmmieteCents: 120_000,
      radiusKm: 10,
      adults: 1,
      children: 0,
      minRooms: 1,
      preferredRooms: 2,
      furnished: 'PREFERRED',
      wbsStatus: 'NOT_AVAILABLE',
      temporaryMode: false,
    },
  });
  const source = await prisma.source.create({
    data: { key: 'rescore-src', name: 'Testquelle', websiteUrl: 'https://example.de', route: 'DISCOVERY' },
  });
  const listing = await prisma.listing.create({
    data: {
      sourceId: source.id,
      importedById: user.id,
      canonicalUrl: 'https://example.de/koeln-1',
      rawUrl: 'https://example.de/koeln-1',
      title: '2-Zimmer-Wohnung in Köln-Nippes',
      propertyType: 'APARTMENT',
      furnishing: 'FURNISHED',
      rooms: 2,
      livingSpaceSqm: 60,
      kaltMieteCents: 70_000,
      effectiveMonthlyCents: 70_000,
      monthlyTotalComplete: false,
      locationCity: 'Köln',
      // A different two-digit prefix from the workplace, same city.
      locationPostal: '50733',
      origin: 'DISCOVERY',
      expired: false,
    },
  });
  const match = await prisma.candidateListingMatch.create({
    data: {
      candidateCaseId: candidate.id,
      listingId: listing.id,
      status: 'NEW',
      // What the old, broken rules decided.
      compatibility: 'NEAR_MATCH',
      score: 61,
      rankVersion: 'rank-2020-01-01-alt',
      breakdown: {},
      reasons: [],
      blockers: [],
    },
  });
  return { candidateId: candidate.id, matchId: match.id };
}

describe('a rule change reaching the candidates who already exist', () => {
  it('recomputes matches that were scored under an older version', async () => {
    const { candidateId, matchId } = await seedStaleMatch();
    const { recomputeAllForCandidate } = await import('@/server/ranking');

    await recomputeAllForCandidate(candidateId);

    const after = await prisma.candidateListingMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(after.rankVersion).toBe(RANK_VERSION);
  });

  it('applies today’s rules, not the ones stored with the match', async () => {
    // Both fixes at once: 50733 and 50937 are one city, and a Kaltmiete-only
    // advert comfortably inside budget is not a reservation. Under the old
    // rules this row was NEAR_MATCH; under today's it is simply passend.
    const { candidateId, matchId } = await seedStaleMatch();
    const { recomputeAllForCandidate } = await import('@/server/ranking');

    await recomputeAllForCandidate(candidateId);

    const after = await prisma.candidateListingMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(after.compatibility).toBe('COMPATIBLE');
  });

  it('leaves the colleague’s own decision alone', async () => {
    // Re-scoring may change a verdict; it must never undo "contacted" or
    // "rejected", which are records of what a person did.
    const { candidateId, matchId } = await seedStaleMatch();
    await prisma.candidateListingMatch.update({ where: { id: matchId }, data: { status: 'CONTACTED' } });
    const { recomputeAllForCandidate } = await import('@/server/ranking');

    await recomputeAllForCandidate(candidateId);

    const after = await prisma.candidateListingMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(after.status).toBe('CONTACTED');
  });
});
