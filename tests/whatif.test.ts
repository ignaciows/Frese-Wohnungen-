import { describe, expect, it } from 'vitest';
import {
  blockerBreakdown,
  countUnder,
  diagnose,
  simulate,
  suggestRelaxations,
} from '@/domain/whatif';
import type { RankingListing, RankingProfile } from '@/domain/ranking';

const profile: RankingProfile = {
  workplaceLat: null,
  workplaceLon: null,
  maxWarmmieteCents: 90000,
  maxCommuteMinutes: 35,
  radiusKm: 20,
  adults: 1,
  children: 0,
  minRooms: 2,
  preferredRooms: 3,
  furnished: 'PREFERRED',
  wbsStatus: 'NOT_AVAILABLE',
  temporaryMode: false,
};

function listing(over: Partial<RankingListing> = {}): RankingListing {
  return {
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
    ...over,
  };
}

describe('counting under a profile', () => {
  it('counts a good listing as compatible', () => {
    const c = countUnder([listing()], profile);
    expect(c.compatible).toBe(1);
  });

  it('counts an over-budget listing as incompatible', () => {
    const c = countUnder([listing({ effectiveMonthlyCents: 200000 })], profile);
    expect(c.incompatible).toBe(1);
  });
});

describe('simulation', () => {
  it('raising the budget converts an over-budget listing', () => {
    // Budget only blocks hard above 115 % of the cap, so 1100 € vs 900 € is
    // genuinely incompatible while 1000 € would merely be "slightly over".
    const over = listing({ effectiveMonthlyCents: 110000 });
    expect(countUnder([over], profile).incompatible).toBe(1);

    const r = simulate([over], profile, { maxWarmmieteCents: 130000 });
    expect(r.usable).toBe(1);
    expect(r.gained).toBe(1);
  });

  it('reports a loss when the profile is tightened', () => {
    const r = simulate([listing()], profile, { maxWarmmieteCents: 50000 });
    expect(r.gained).toBeLessThan(0);
  });

  it('lowering the room minimum unlocks a smaller flat', () => {
    const small = listing({ rooms: 1 });
    const r = simulate([small], profile, { minRooms: 1 });
    expect(r.gained).toBe(1);
  });

  it('never mutates the profile it was given', () => {
    const before = { ...profile };
    simulate([listing()], profile, { maxWarmmieteCents: 500000, minRooms: 1 });
    expect(profile).toEqual(before);
  });
});

describe('relaxation suggestions', () => {
  it('suggests the change that unlocks the most listings, best first', () => {
    const listings = [
      listing({ effectiveMonthlyCents: 110000 }),
      listing({ effectiveMonthlyCents: 112000 }),
      listing({ rooms: 1 }),
    ];
    const s = suggestRelaxations(listings, profile);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].gained).toBeGreaterThanOrEqual(s[s.length - 1].gained);
    // Two listings sit just above budget, so budget should be the top lever.
    expect(s[0].key).toMatch(/budget/);
  });

  it('only offers changes that actually gain something', () => {
    const s = suggestRelaxations([listing()], profile);
    expect(s.every((x) => x.gained > 0)).toBe(true);
  });

  it('returns nothing when loosening cannot help', () => {
    // A WG room stays excluded no matter how the numeric filters move.
    const s = suggestRelaxations([listing({ propertyType: 'WG_ROOM' })], profile);
    expect(s).toEqual([]);
  });
});

describe('diagnosis tells apart the two failure modes', () => {
  it('says so when nothing has been imported', () => {
    const d = diagnose([], profile);
    expect(d.kind).toBe('NO_LISTINGS');
    expect(d.message).toContain('importiert');
  });

  it('flags criteria that are too tight when a single change would help', () => {
    const d = diagnose([listing({ effectiveMonthlyCents: 110000 })], profile);
    expect(d.kind).toBe('CRITERIA_TOO_TIGHT');
  });

  it('calls it a supply problem when no loosening helps', () => {
    const d = diagnose([listing({ propertyType: 'WG_ROOM' })], profile);
    expect(d.kind).toBe('SUPPLY_PROBLEM');
  });

  it('reports FINE when listings already match', () => {
    const d = diagnose([listing()], profile);
    expect(d.kind).toBe('FINE');
  });
});

describe('blocker breakdown', () => {
  it('groups incompatible listings by what actually blocked them', () => {
    const b = blockerBreakdown(
      [
        listing({ effectiveMonthlyCents: 200000 }),
        listing({ rooms: 0.5 }),
        listing({ wbsRequired: 'YES' }),
        listing({ exchangeRequired: 'YES' }),
      ],
      profile,
    );
    expect(b.budget).toBe(1);
    expect(b.rooms).toBe(1);
    expect(b.wbs).toBe(1);
    expect(b.propertyType).toBe(1);
  });

  it('ignores listings that are not blocked', () => {
    const b = blockerBreakdown([listing()], profile);
    expect(Object.values(b).reduce((a, n) => a + n, 0)).toBe(0);
  });
});
