import { describe, expect, it } from 'vitest';
import { isPlausibleHousing, type PlausibilityLimits } from '@/domain/discovery/plausible';
import { DEFAULT_QUALITY } from '@/server/settings';
import {
  score,
  timingSubscore,
  certaintyCap,
  DEFAULT_WEIGHTS,
  MAX_SCORE,
} from '@/domain/ranking';
import type { RankingListing, RankingProfile } from '@/domain/ranking';

const LIMITS: PlausibilityLimits = {
  minMonthlyCents: DEFAULT_QUALITY.minMonthlyEuros * 100,
  maxMonthlyCents: DEFAULT_QUALITY.maxMonthlyEuros * 100,
  maxRooms: DEFAULT_QUALITY.maxRooms,
  minSqm: DEFAULT_QUALITY.minSqm,
  rejectShortStay: DEFAULT_QUALITY.rejectShortStay,
};

describe('impossible adverts', () => {
  it('throws out a flat at 100 € a month', () => {
    const r = isPlausibleHousing(
      { title: '2-Zimmer-Wohnung in Heilbronn', structured: { warmMieteCents: 10_000, rooms: 2 } },
      LIMITS,
    );
    expect(r.plausible).toBe(false);
    expect(r.reason).toContain('100 €');
  });

  it('throws out a twenty-room "flat"', () => {
    const r = isPlausibleHousing(
      { title: 'Wohnung mit vielen Zimmern', structured: { warmMieteCents: 90_000, rooms: 20 } },
      LIMITS,
    );
    expect(r.plausible).toBe(false);
    expect(r.reason).toContain('20 Zimmer');
  });

  it('throws out a four-week let however it is titled', () => {
    const r = isPlausibleHousing(
      {
        title: 'Schönes Apartment in Heilbronn',
        description: 'Ideal für Monteure, wöchentlich kündbar, ab 4 Wochen.',
        structured: { warmMieteCents: 80_000, rooms: 2 },
      },
      LIMITS,
    );
    expect(r.plausible).toBe(false);
    expect(r.reason).toContain('Wohnen auf Zeit');
  });

  it('throws out a broom cupboard', () => {
    const r = isPlausibleHousing(
      { title: '1-Zimmer-Wohnung', structured: { warmMieteCents: 40_000, livingSpaceSqm: 9 } },
      LIMITS,
    );
    expect(r.plausible).toBe(false);
    expect(r.reason).toContain('9 m²');
  });

  it('lets an ordinary flat through untouched', () => {
    const r = isPlausibleHousing(
      {
        title: '2-Zimmer-Wohnung mit Balkon',
        description: 'Ruhige Lage, Nähe Klinikum. Unbefristeter Mietvertrag.',
        structured: { warmMieteCents: 78_000, rooms: 2, livingSpaceSqm: 58 },
      },
      LIMITS,
    );
    expect(r.plausible).toBe(true);
  });

  it('does not reject a fixed-term flat that is still somewhere to live', () => {
    const r = isPlausibleHousing(
      {
        title: '3-Zimmer-Wohnung',
        description: 'Befristet auf zwei Jahre wegen Eigenbedarf.',
        structured: { warmMieteCents: 95_000, rooms: 3, livingSpaceSqm: 74 },
      },
      LIMITS,
    );
    expect(r.plausible).toBe(true);
  });

  it('leaves every rule off when no limits are passed', () => {
    const r = isPlausibleHousing({
      title: 'Apartment auf Zeit',
      structured: { warmMieteCents: 20_000, rooms: 12 },
    });
    expect(r.plausible).toBe(true);
  });
});

/* ------------------------------------------------------------- scoring --- */

const ARRIVAL = new Date('2026-11-01T00:00:00Z');
const d = (iso: string) => new Date(iso);

function profile(over: Partial<RankingProfile> = {}): RankingProfile {
  return {
    workplaceLat: null,
    workplaceLon: null,
    maxWarmmieteCents: 90_000,
    maxCommuteMinutes: 35,
    radiusKm: 25,
    adults: 1,
    children: 0,
    minRooms: 1,
    preferredRooms: 2,
    furnished: 'EITHER',
    wbsStatus: 'UNKNOWN',
    temporaryMode: false,
    moveInDate: ARRIVAL,
    ...over,
  };
}

function listing(over: Partial<RankingListing> = {}): RankingListing {
  return {
    propertyType: 'APARTMENT',
    furnishing: 'UNFURNISHED',
    fittedKitchen: 'UNKNOWN',
    effectiveMonthlyCents: 80_000,
    monthlyTotalComplete: true,
    kaltMieteCents: 65_000,
    rooms: 2,
    wbsRequired: 'NO',
    exchangeRequired: 'NO',
    petsAllowed: 'UNKNOWN',
    fixedTerm: 'NO',
    distanceKm: 8,
    commuteMinutes: 14,
    livingSpaceSqm: 58,
    ...over,
  };
}

describe('move-in timing', () => {
  it('gives full marks to a flat free before the arrival', () => {
    expect(timingSubscore(listing({ availableFrom: d('2026-10-01T00:00:00Z') }), profile()).pct).toBe(100);
  });

  it('scores a short gap above a long one', () => {
    const short = timingSubscore(listing({ availableFrom: d('2026-11-05T00:00:00Z') }), profile()).pct;
    const long = timingSubscore(listing({ availableFrom: d('2026-12-20T00:00:00Z') }), profile()).pct;
    expect(short).toBeGreaterThan(long);
  });

  it('ranks an advert with no date below one that is two weeks late', () => {
    const none = timingSubscore(listing({ availableFrom: null }), profile()).pct;
    const late = timingSubscore(listing({ availableFrom: d('2026-11-15T00:00:00Z') }), profile()).pct;
    expect(none).toBeLessThan(late);
  });

  it('stays neutral when the profile has no arrival date', () => {
    const r = timingSubscore(listing({ availableFrom: null }), profile({ moveInDate: null }));
    expect(r.pct).toBe(70);
    expect(r.reason).toContain('Profil');
  });

  it('moves the total score, not just the breakdown', () => {
    const onTime = score(listing({ availableFrom: d('2026-10-15T00:00:00Z') }), profile(), DEFAULT_WEIGHTS);
    const tooLate = score(listing({ availableFrom: d('2027-01-15T00:00:00Z') }), profile(), DEFAULT_WEIGHTS);
    expect(onTime.score).toBeGreaterThan(tooLate.score);
    expect(onTime.reasons.some((r) => r.includes('Frei vor der Ankunft'))).toBe(true);
  });
});

describe('the ceiling', () => {
  it('never reaches 100, even with everything known and perfect', () => {
    const perfect = score(
      listing({
        availableFrom: d('2026-10-01T00:00:00Z'),
        effectiveMonthlyCents: 40_000,
        monthlyTotalComplete: true,
        distanceKm: 1,
        commuteMinutes: 3,
        rooms: 2,
        furnishing: 'FULLY_FURNISHED',
      }),
      profile({ furnished: 'EITHER', preferredRooms: 2 }),
    );
    expect(perfect.score).toBeLessThanOrEqual(MAX_SCORE);
    expect(perfect.score).toBeLessThan(100);
  });

  it('caps a flat whose distance nobody could compute', () => {
    const { cap, missing } = certaintyCap(
      listing({ distanceKm: null, commuteMinutes: null, availableFrom: d('2026-10-01T00:00:00Z') }),
      profile(),
    );
    expect(cap).toBe(85);
    expect(missing).toContain('Entfernung unbekannt');
  });

  it('caps hardest on the advert that names no move-in date', () => {
    const { cap } = certaintyCap(listing({ availableFrom: null }), profile());
    expect(cap).toBe(82);
  });

  it('holds the score down to the cap, however good the rest is', () => {
    const r = score(
      listing({
        availableFrom: null,
        distanceKm: null,
        commuteMinutes: null,
        effectiveMonthlyCents: 30_000,
        monthlyTotalComplete: true,
      }),
      profile(),
    );
    expect(r.score).toBeLessThanOrEqual(82);
    expect(r.breakdown.cap).toBe(82);
  });
});
