/**
 * The simulator does not rank the listings the results page ranks — it loads
 * its own copies and re-ranks them live, so that moving a slider can answer
 * instantly. That means the ranking engine has two callers, and the pair only
 * agree for as long as both hand it the same fields.
 *
 * They stopped agreeing. When the postcode location check was added, the
 * results page learned to pass the workplace postcode and the advert's
 * postcode; this loader did not. With nothing to compare, the check returned
 * "unknown" and stayed silent, so the panel announced "3 Anzeigen passen
 * bereits zum aktuellen Profil" directly above three rows each marked "Nicht
 * passend — ganz andere Gegend (PLZ 74 statt 50)". Two answers on one screen.
 *
 * A unit test of the ranking engine cannot catch that: the engine was right
 * both times. Only loading through the real query does.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import { loadSimulationInputs } from '@/server/whatif';
import { rank } from '@/domain/ranking';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

/** A nurse starting in Cologne, and one flat in Heilbronn — 300 km away. */
async function seedCologneCandidateWithHeilbronnFlat() {
  const { hashPassword } = await import('@/lib/auth');
  const user = await prisma.user.create({
    data: {
      email: 'whatif@test.local',
      name: 'Test',
      role: 'ADMIN',
      passwordHash: await hashPassword('test-pw-1234'),
    },
  });
  const candidate = await prisma.candidateCase.create({
    data: { reference: 'CAND-WI-01', displayName: 'Test', createdById: user.id },
  });
  await prisma.searchProfile.create({
    data: {
      candidateCaseId: candidate.id,
      workplaceAddress: 'Uniklinik Köln',
      workplaceCity: 'Köln',
      workplacePostalCode: '50937',
      maxWarmmieteCents: 117500,
      maxCommuteMinutes: 40,
      radiusKm: 20,
      adults: 1,
      children: 0,
      minRooms: 1,
      preferredRooms: 2,
      furnished: 'PREFERRED',
      wbsStatus: 'NOT_AVAILABLE',
      temporaryMode: true,
    },
  });
  const source = await prisma.source.create({
    data: {
      key: 'whatif-source',
      name: 'Testquelle',
      websiteUrl: 'https://example.de',
      route: 'DISCOVERY',
    },
  });
  const listing = await prisma.listing.create({
    data: {
      sourceId: source.id,
      importedById: user.id,
      canonicalUrl: 'https://example.de/ad-heilbronn',
      rawUrl: 'https://example.de/ad-heilbronn',
      title: 'Vollmöbliertes 2-Zimmer-Apartment in Bad Rappenau-Fürfeld',
      propertyType: 'APARTMENT',
      furnishing: 'FURNISHED',
      rooms: 2,
      kaltMieteCents: 78000,
      effectiveMonthlyCents: 78000,
      monthlyTotalComplete: true,
      locationCity: 'Bad Rappenau',
      locationPostal: '74906',
      origin: 'DISCOVERY',
      expired: false,
    },
  });
  await prisma.candidateListingMatch.create({
    data: {
      candidateCaseId: candidate.id,
      listingId: listing.id,
      status: 'NEW',
      breakdown: {},
      reasons: [],
      blockers: [],
    },
  });
  return { candidateId: candidate.id };
}

describe('what the simulator is given to rank', () => {
  it('carries the postcodes the location check needs', async () => {
    const { candidateId } = await seedCologneCandidateWithHeilbronnFlat();

    const { listings, profile } = await loadSimulationInputs(candidateId);

    expect(profile.workplacePostalCode).toBe('50937');
    expect(profile.workplaceCity).toBe('Köln');
    expect(listings[0].locationPostal).toBe('74906');
    expect(listings[0].locationCity).toBe('Bad Rappenau');
  });

  it('reaches the same verdict as the results list, not the opposite one', async () => {
    // The whole point. A flat three hundred kilometres from the job is not a
    // match, and the panel must not say it is while the list says it is not.
    const { candidateId } = await seedCologneCandidateWithHeilbronnFlat();

    const { listings, profile } = await loadSimulationInputs(candidateId);
    const verdict = rank(listings[0], profile);

    expect(verdict.compatibility).toBe('INCOMPATIBLE');
    expect(verdict.blockers.join(' ')).toMatch(/Gegend/);
  });
});
