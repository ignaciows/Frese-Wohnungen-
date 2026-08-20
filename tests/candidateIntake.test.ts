/**
 * What creating a candidate must record.
 *
 * The form was cut from sixteen fields to four, and two of the things it asks
 * for changed shape: an employer, and a distance in kilometres where it used to
 * ask for a commute in minutes. Both are easy to get half-right — a profile
 * that carries a radius *and* a leftover 35-minute default is judged on the
 * minutes, which is the number nobody chose.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import { createCandidateCase } from '@/server/candidates';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

async function creator() {
  const { hashPassword } = await import('@/lib/auth');
  const user = await prisma.user.create({
    data: {
      email: 'intake@test.local',
      name: 'Test',
      role: 'ADMIN',
      passwordHash: await hashPassword('test-pw-1234'),
    },
  });
  return user.id;
}

const base = {
  reference: 'CAND-INT-01',
  displayName: 'Khaoula Mgaidi',
  maxWarmmieteCents: 90_000,
  minRooms: 1,
  preferredRooms: 2,
  adults: 1,
  children: 0,
  furnished: 'PREFERRED' as const,
  wbsStatus: 'NOT_AVAILABLE' as const,
  temporaryMode: false,
};

describe('creating a candidate from the short form', () => {
  it('keeps the employer, which is how a colleague recognises the case', async () => {
    const createdById = await creator();

    const c = await createCandidateCase({
      ...base,
      createdById,
      employerName: 'SLK-Kliniken Heilbronn',
      workplace: { address: 'Am Gesundbrunnen 20, 74078 Heilbronn', city: 'Heilbronn', postalCode: '74078' },
    });

    const p = await prisma.searchProfile.findUniqueOrThrow({ where: { candidateCaseId: c.id } });
    expect(p.employerName).toBe('SLK-Kliniken Heilbronn');
  });

  it('stores a picked address with its coordinates, marked as such', async () => {
    // A postcode chosen from real results is the whole point: it decides which
    // regional sources are asked and which flats count as nearby.
    const createdById = await creator();

    const c = await createCandidateCase({
      ...base,
      createdById,
      workplace: {
        address: 'Salinenstraße 2, 74906 Bad Rappenau',
        city: 'Bad Rappenau',
        postalCode: '74906',
        lat: 49.2376,
        lon: 9.1043,
      },
    });

    const p = await prisma.searchProfile.findUniqueOrThrow({ where: { candidateCaseId: c.id } });
    expect(p.workplacePostalCode).toBe('74906');
    expect(p.workplaceLat).toBeCloseTo(49.2376, 3);
    expect(p.geocodeStatus).not.toBe('UNKNOWN');
  });

  it('does not leave a commute default beside a chosen radius', async () => {
    // Both set means the ranking judges on an invented travel time instead of
    // the distance somebody actually picked.
    const createdById = await creator();

    const c = await createCandidateCase({
      ...base,
      createdById,
      radiusKm: 5,
      maxCommuteMinutes: null,
      workplace: { address: 'Am Gesundbrunnen 20', city: 'Heilbronn', postalCode: '74078' },
    });

    const p = await prisma.searchProfile.findUniqueOrThrow({ where: { candidateCaseId: c.id } });
    expect(p.radiusKm).toBe(5);
    expect(p.maxCommuteMinutes).toBeNull();
  });

  it('still fills in the fields the short form no longer asks for', async () => {
    // The point of hiding them is that they have defensible defaults, not that
    // they stop existing.
    const createdById = await creator();

    const c = await createCandidateCase({
      ...base,
      createdById,
      workplace: { address: 'Am Gesundbrunnen 20', city: 'Heilbronn', postalCode: '74078' },
    });

    const p = await prisma.searchProfile.findUniqueOrThrow({ where: { candidateCaseId: c.id } });
    expect(p.maxWarmmieteCents).toBe(90_000);
    expect(p.adults).toBe(1);
    expect(p.furnished).toBe('PREFERRED');
  });
});
