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

  /**
   * Most ads automatic discovery brings in publish a single headline price and
   * no Nebenkosten, so this branch decides the fate of the bulk of the pool.
   * The Kaltmiete is a lower bound on the Warmmiete, which is what makes these
   * judgements safe.
   */
  describe('when only the Kaltmiete is known', () => {
    const kaltOnly = (kaltMieteCents: number): RankingListing => ({
      ...baseListing,
      monthlyTotalComplete: false,
      effectiveMonthlyCents: kaltMieteCents,
      kaltMieteCents,
    });

    it('a cold rent far above the cap is INCOMPATIBLE', () => {
      // 1.800 € cold cannot become 900 € warm under any Nebenkosten.
      const r = rank(kaltOnly(180000), baseProfile);
      expect(r.compatibility).toBe('INCOMPATIBLE');
      expect(r.blockers.join(' ')).toMatch(/Budget/);
    });

    it('a cold rent just over the cap is a soft flag, not a block', () => {
      const r = rank(kaltOnly(95000), baseProfile);
      expect(r.compatibility).not.toBe('INCOMPATIBLE');
      expect(r.reasons.join(' ')).toMatch(/Kaltmiete/);
    });

    it('a cold rent well under the cap is simply passend, and says the total is estimated', () => {
      // It used to come back NEAR_MATCH. Two thirds of adverts state only a
      // Kaltmiete, so two thirds of the pool could never be "Passend" however
      // well they fitted — on the live screen a 700 € flat against a 900 €
      // budget scored 82, showed green, and was labelled "Fast passend".
      // The Nebenkosten are estimated, not unknown; an estimate that lands
      // comfortably under budget is a fact to print, not a decision to make.
      const r = rank(kaltOnly(70000), baseProfile);
      expect(r.compatibility).toBe('COMPATIBLE');
      expect(r.reasons.join(' ')).toMatch(/geschätzt/);
    });

    it('but an estimate that lands over the cap is still a reservation', () => {
      // 800 € cold with no size given: the fallback adds a quarter, so about
      // 1.000 € warm against a 900 € cap. Over budget, but not so far that it
      // stops being worth a look.
      const r = rank(kaltOnly(80000), baseProfile);
      expect(r.compatibility).toBe('NEAR_MATCH');
      expect(r.reasons.join(' ')).toMatch(/über Budget/);
    });

    it('the estimate is only consulted once the cold rent itself fits', () => {
      // 950 € cold against a 900 € cap is caught by the earlier rule and stays
      // a soft flag — deliberately, because erring towards showing a flat
      // costs a click and erring the other way costs the flat. The estimate
      // decides only where the cold rent leaves the question open.
      const r = rank(kaltOnly(95000), baseProfile);
      expect(r.compatibility).toBe('NEAR_MATCH');
      expect(r.reasons.join(' ')).toMatch(/Kaltmiete/);
    });

    it('raising the budget actually changes the verdict', () => {
      // The property the what-if simulator depends on: if this stops holding,
      // every "+N listings" suggestion silently becomes "+0".
      const listing = kaltOnly(120000);
      expect(rank(listing, baseProfile).compatibility).toBe('INCOMPATIBLE');
      expect(rank(listing, { ...baseProfile, maxWarmmieteCents: 150000 }).compatibility).not.toBe(
        'INCOMPATIBLE',
      );
    });
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

  it('an incomplete total is estimated and said so, not held against the flat', () => {
    const r = rank(
      {
        ...baseListing,
        effectiveMonthlyCents: 70000,
        monthlyTotalComplete: false,
      },
      baseProfile,
    );
    expect(r.compatibility).toBe('COMPATIBLE');
    // Still surfaced — the reader must know which number is a measurement and
    // which is arithmetic.
    expect(r.reasons.some((x) => x.includes('geschätzt'))).toBe(true);
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

  /**
   * The two-digit postcode rule breaks exactly where the flats are.
   *
   * Hamburg runs 20095–22769. A job in Altona (22765) and a flat in Rotherbaum
   * (20146) are six kilometres and one S-Bahn ride apart, and came out as
   * "Andere PLZ-Region" — a soft flag, which downgrades the listing to "Fast
   * passend" permanently. On the live screen an 82-point Hamburg flat sat
   * under a green score with a label saying it did not quite fit.
   */
  it('does not treat one Hamburg district as another region from another', () => {
    const hamburg = { ...baseProfile, workplacePostalCode: '22765' };
    const rotherbaum = {
      ...baseListing,
      distanceKm: null,
      commuteMinutes: null,
      locationPostal: '20146',
    };

    const r = rank(rotherbaum, hamburg);

    expect(r.compatibility).toBe('COMPATIBLE');
    expect(r.reasons.join(' ')).not.toMatch(/PLZ-Region|andere Gegend/);
  });

  it('still catches a flat that really is in another part of the country', () => {
    // The guard must not cost us the error it exists to find.
    const hamburg = { ...baseProfile, workplacePostalCode: '22765' };
    const koeln = {
      ...baseListing,
      distanceKm: null,
      commuteMinutes: null,
      locationPostal: '50667',
    };

    const r = rank(koeln, hamburg);

    expect(r.compatibility).toBe('INCOMPATIBLE');
    expect(r.blockers.join(' ')).toMatch(/andere Gegend/);
  });

  it('a real review flag still downgrades to NEAR_MATCH', () => {
    // An unknown distance and an estimated total are both information. A rent
    // that actually exceeds the budget is a decision, and that is what must
    // still cost the listing its "Passend".
    const r = rank(
      {
        ...baseListing,
        furnishing: 'FULLY_FURNISHED',
        distanceKm: null,
        commuteMinutes: null,
        effectiveMonthlyCents: 95000,
        monthlyTotalComplete: true,
      },
      geoProfile,
    );
    expect(r.compatibility).toBe('NEAR_MATCH');
    expect(r.reasons.join(' ')).toMatch(/über Budget/);
  });
});

/* ------------------------------------------------- location sanity check --- */

describe('telling a far-away flat from a nearby one without a geocoder', () => {
  // The bug this covers, straight off the live site: a candidate working in
  // Köln (50xxx) was shown a flat in Bad Rappenau (74906) rated 86 points and
  // labelled "Passend", because an unknown distance scored as merely neutral.
  const koeln = {
    ...baseProfile,
    workplaceLat: null,
    workplaceLon: null,
    workplacePostalCode: '50667',
    workplaceCity: 'Köln',
    radiusKm: 25,
  };
  const flat = {
    ...baseListing,
    distanceKm: null,
    commuteMinutes: null,
    rooms: 2,
    effectiveMonthlyCents: 78000,
    monthlyTotalComplete: true,
    furnishing: 'FURNISHED' as const,
    fittedKitchen: 'UNKNOWN' as const,
  };

  it('rules out a flat in a different postal zone', () => {
    const r = rank({ ...flat, locationPostal: '74906', locationCity: 'Bad Rappenau' }, koeln);
    expect(r.compatibility).toBe('INCOMPATIBLE');
    expect(r.blockers.join(' ')).toContain('andere Gegend');
    expect(r.score).toBe(0);
  });

  it('flags a different region in the same zone without ruling it out', () => {
    // 57xxx is the same leading digit as 50xxx: far enough to check, close
    // enough that rejecting it outright would lose real options.
    const r = rank({ ...flat, locationPostal: '57462', locationCity: 'Olpe' }, koeln);
    expect(r.compatibility).not.toBe('INCOMPATIBLE');
    expect(r.reasons.join(' ')).toContain('PLZ-Region');
  });

  it('leaves a flat in the same region alone', () => {
    const r = rank({ ...flat, locationPostal: '50937', locationCity: 'Köln' }, koeln);
    expect(r.compatibility).toBe('COMPATIBLE');
  });

  it('never rejects on a town name alone — a suburb has a different name', () => {
    // Leverkusen is 15 minutes from Köln. Without a postcode we may say we do
    // not know, but we must not rule it out.
    const r = rank({ ...flat, locationPostal: null, locationCity: 'Leverkusen' }, koeln);
    expect(r.compatibility).not.toBe('INCOMPATIBLE');
  });

  it('still prefers a real geocoded distance when there is one', () => {
    // Postcodes disagree, but the measured distance is short and wins.
    const r = rank(
      { ...flat, distanceKm: 8, locationPostal: '74906', locationCity: 'Bad Rappenau' },
      koeln,
    );
    expect(r.compatibility).toBe('COMPATIBLE');
  });
});
