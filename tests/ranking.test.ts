import { describe, expect, it } from 'vitest';
import {
  rank,
  suggestedMinRooms,
  suggestedPreferredRooms,
  type RankingListing,
  type RankingProfile,
} from '@/domain/ranking';

const baseProfile: RankingProfile = {
  workplaceLat: null,
  workplaceLon: null,
  maxWarmmieteCents: 90000,
  maxCommuteMinutes: 35,
  radiusKm: null,
  adults: 1,
  children: 0,
  minRooms: 1,
  preferredRooms: 2,
  furnished: 'PREFERRED',
  wbsStatus: 'NOT_AVAILABLE',
  temporaryMode: false,
};

const baseListing: RankingListing = {
  propertyType: 'APARTMENT',
  furnishing: 'FURNISHED',
  fittedKitchen: 'UNKNOWN',
  effectiveMonthlyCents: 80000,
  monthlyTotalComplete: true,
  kaltMieteCents: 70000,
  rooms: 2,
  wbsRequired: 'UNKNOWN',
  exchangeRequired: 'UNKNOWN',
  petsAllowed: 'UNKNOWN',
  fixedTerm: 'UNKNOWN',
  distanceKm: null,
  commuteMinutes: 20,
};

describe('ranking: compatibility', () => {
  it('marks strong apartment as COMPATIBLE', () => {
    const r = rank({ ...baseListing, furnishing: 'FULLY_FURNISHED' }, baseProfile);
    expect(r.compatibility).toBe('COMPATIBLE');
  });

  it('extreme over-budget is INCOMPATIBLE', () => {
    const r = rank({ ...baseListing, effectiveMonthlyCents: 200000 }, baseProfile);
    expect(r.compatibility).toBe('INCOMPATIBLE');
  });

  it('too few rooms is INCOMPATIBLE', () => {
    const r = rank(
      { ...baseListing, rooms: 0.5 },
      { ...baseProfile, minRooms: 1, preferredRooms: 2 },
    );
    expect(r.compatibility).toBe('INCOMPATIBLE');
  });

  it('WBS incompatibility is a hard block', () => {
    const r = rank({ ...baseListing, wbsRequired: 'YES' }, { ...baseProfile, wbsStatus: 'NOT_AVAILABLE' });
    expect(r.compatibility).toBe('INCOMPATIBLE');
    expect(r.blockers.some((b) => b.includes('WBS'))).toBe(true);
  });

  it('exchange requirement blocks', () => {
    const r = rank({ ...baseListing, exchangeRequired: 'YES' }, baseProfile);
    expect(r.compatibility).toBe('INCOMPATIBLE');
  });

  it('unknown furnishing is not the same as unfurnished', () => {
    const r = rank({ ...baseListing, furnishing: 'UNKNOWN' }, baseProfile);
    // "PREFERRED" + unknown -> NEAR_MATCH-ish, never INCOMPATIBLE.
    expect(r.compatibility).not.toBe('INCOMPATIBLE');
  });

  it('unknown total monthly cost produces near-match warning', () => {
    const r = rank(
      {
        ...baseListing,
        effectiveMonthlyCents: 70000,
        monthlyTotalComplete: false,
      },
      baseProfile,
    );
    expect(r.compatibility).toBe('NEAR_MATCH');
    expect(r.reasons.some((r) => r.includes('unbekannt') || r.includes('unvoll'))).toBe(true);
  });

  it('required-furnished blocks unfurnished', () => {
    const r = rank({ ...baseListing, furnishing: 'UNFURNISHED' }, { ...baseProfile, furnished: 'REQUIRED' });
    expect(r.compatibility).toBe('INCOMPATIBLE');
  });
});

describe('ranking: scoring', () => {
  it('furnished outranks slightly cheaper unfurnished (when otherwise comparable)', () => {
    const furnished = rank(
      { ...baseListing, furnishing: 'FULLY_FURNISHED', effectiveMonthlyCents: 85000 },
      baseProfile,
    );
    const cheaperUnfurnished = rank(
      { ...baseListing, furnishing: 'UNFURNISHED', effectiveMonthlyCents: 75000 },
      baseProfile,
    );
    expect(furnished.score).toBeGreaterThan(cheaperUnfurnished.score);
  });

  it('partial furnished scores less than fully furnished', () => {
    const full = rank({ ...baseListing, furnishing: 'FULLY_FURNISHED' }, baseProfile);
    const partial = rank({ ...baseListing, furnishing: 'PARTIALLY_FURNISHED' }, baseProfile);
    expect(full.score).toBeGreaterThan(partial.score);
  });

  it('score breakdown fields are within 0..100', () => {
    const r = rank({ ...baseListing, furnishing: 'FULLY_FURNISHED' }, baseProfile);
    for (const key of ['furnishing', 'rooms', 'budget', 'commute', 'completeness', 'total'] as const) {
      expect(r.breakdown[key]).toBeGreaterThanOrEqual(0);
      expect(r.breakdown[key]).toBeLessThanOrEqual(100);
    }
  });

  it('stable ordering for identical listings', () => {
    const r1 = rank({ ...baseListing, furnishing: 'FURNISHED' }, baseProfile);
    const r2 = rank({ ...baseListing, furnishing: 'FURNISHED' }, baseProfile);
    expect(r1.score).toBe(r2.score);
    expect(r1.compatibility).toBe(r2.compatibility);
  });
});

describe('household → room suggestions', () => {
  it('single adult defaults to 1/2', () => {
    expect(suggestedMinRooms(1, 0)).toBe(1);
    expect(suggestedPreferredRooms(1, 0)).toBe(2);
  });
  it('couple no children -> 2/2', () => {
    expect(suggestedMinRooms(2, 0)).toBe(2);
    expect(suggestedPreferredRooms(2, 0)).toBe(2);
  });
  it('couple + 1 child -> 3/3', () => {
    expect(suggestedMinRooms(2, 1)).toBe(3);
    expect(suggestedPreferredRooms(2, 1)).toBe(3);
  });
  it('couple + 2 children -> 3/4', () => {
    expect(suggestedMinRooms(2, 2)).toBe(3);
    expect(suggestedPreferredRooms(2, 2)).toBe(4);
  });
  it('couple + 3 children -> 4/5', () => {
    expect(suggestedMinRooms(2, 3)).toBe(4);
    expect(suggestedPreferredRooms(2, 3)).toBe(5);
  });
});

describe('ranking: unresolvable-but-harmless data', () => {
  const geoProfile: RankingProfile = { ...baseProfile, workplaceLat: 49.2, workplaceLon: 9.1, maxCommuteMinutes: 35 };

  it('unknown distance alone does NOT downgrade a good listing', () => {
    const r = rank(
      { ...baseListing, furnishing: 'FULLY_FURNISHED', distanceKm: null, commuteMinutes: null },
      geoProfile,
    );
    expect(r.compatibility).toBe('COMPATIBLE');
    // …but it is still surfaced to the user.
    expect(r.reasons.some((x) => x.includes('Entfernung unbekannt'))).toBe(true);
  });

  it('a real review flag still downgrades to NEAR_MATCH', () => {
    const r = rank(
      {
        ...baseListing,
        furnishing: 'FULLY_FURNISHED',
        distanceKm: null,
        commuteMinutes: null,
        monthlyTotalComplete: false,
      },
      geoProfile,
    );
    expect(r.compatibility).toBe('NEAR_MATCH');
  });
});
