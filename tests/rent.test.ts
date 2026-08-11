/**
 * What a flat costs, and whether the figure can be a rent at all.
 *
 * Every number in here came out of the live pool on 2026-08-11: 103 of 160
 * adverts stated only a Kaltmiete, and the three cheapest were 18 €, 20 € and
 * 80 € — nightly rates from short-stay adverts around a trade fair, read as
 * monthly rents and sitting at the top of anything sorted by price.
 */

import { describe, expect, it } from 'vitest';
import { assessRent, estimateNebenkostenCents } from '@/domain/rent';

describe('what the flat will actually cost', () => {
  it('takes a stated Warmmiete at its word', () => {
    const r = assessRent({ warmMieteCents: 95_000, kaltMieteCents: 78_000 });
    expect(r.basisCents).toBe(95_000);
    expect(r.basisKind).toBe('ACTUAL');
    expect(r.note).toBeNull();
  });

  it('adds the missing Nebenkosten when only the Kaltmiete is printed', () => {
    // The normal case: two thirds of the pool. Comparing 780 € against a warm
    // budget let flats through that then cost far more.
    const r = assessRent({ kaltMieteCents: 78_000, livingSpaceSqm: 60 });

    expect(r.basisKind).toBe('ESTIMATED');
    // 60 m² × 2.50 €/m² = 150 € on top.
    expect(r.basisCents).toBe(78_000 + 15_000);
    expect(r.note).toMatch(/Nur Kaltmiete/);
  });

  it('falls back to a fraction of the rent when the size is unknown', () => {
    const r = assessRent({ kaltMieteCents: 80_000 });
    expect(r.basisCents).toBe(100_000);
    expect(r.basisKind).toBe('ESTIMATED');
  });

  it('adds up the lines the advert did give, and says so when one is missing', () => {
    const both = assessRent({ kaltMieteCents: 70_000, nebenkostenCents: 15_000, heizkostenCents: 8_000 });
    expect(both.basisCents).toBe(93_000);
    expect(both.basisKind).toBe('ACTUAL');

    const partial = assessRent({ kaltMieteCents: 70_000, nebenkostenCents: 15_000 });
    expect(partial.basisCents).toBe(85_000);
    expect(partial.basisKind).toBe('ESTIMATED');
    expect(partial.note).toMatch(/Heiz/);
  });

  it('errs high rather than low', () => {
    // An estimate that flatters a flat sends somebody to a viewing they cannot
    // afford; a slightly pessimistic one only costs a second look.
    const r = assessRent({ kaltMieteCents: 78_000, livingSpaceSqm: 60 });
    expect(r.basisCents!).toBeGreaterThan(78_000);
  });

  it('says nothing at all when the advert gave no price', () => {
    const r = assessRent({});
    expect(r.basisCents).toBeNull();
    expect(r.basisKind).toBe('UNKNOWN');
    expect(r.plausible).toBe(true);
  });
});

describe('figures that cannot be a monthly rent', () => {
  it('rejects the nightly rates that were topping the price-sorted list', () => {
    for (const cents of [1_800, 2_000, 8_000]) {
      const r = assessRent({ kaltMieteCents: cents });
      expect(r.plausible, `${cents}`).toBe(false);
      expect(r.implausibleReason).toMatch(/pro Nacht|Monatsmiete/);
    }
  });

  it('rejects a purchase price that wandered into the rent field', () => {
    const r = assessRent({ kaltMieteCents: 24_500_000 });
    expect(r.plausible).toBe(false);
    expect(r.implausibleReason).toMatch(/Kaufpreis|zu hoch/);
  });

  it('uses the size to catch what the flat figure alone would miss', () => {
    // 200 € is a believable rent for a room, and impossible for 250 m².
    const room = assessRent({ kaltMieteCents: 20_000, livingSpaceSqm: 14 });
    expect(room.plausible).toBe(true);

    const mansion = assessRent({ kaltMieteCents: 20_000, livingSpaceSqm: 250 });
    expect(mansion.plausible).toBe(false);
  });

  it('accepts the ordinary flats it must never touch', () => {
    // A missed flat costs far more than a stray row, so the band is wide.
    const cases = [
      { kaltMieteCents: 33_000, livingSpaceSqm: 14 }, // cheap WG room
      { kaltMieteCents: 45_000, livingSpaceSqm: 20 },
      { kaltMieteCents: 78_000, livingSpaceSqm: 60 },
      { warmMieteCents: 181_800, livingSpaceSqm: 101 }, // real Heilbronn flat
    ];
    for (const c of cases) {
      expect(assessRent(c).plausible, JSON.stringify(c)).toBe(true);
    }
  });
});

describe('estimating the missing costs', () => {
  it('bills per square metre when the size is known', () => {
    expect(estimateNebenkostenCents(80_000, 50)).toBe(12_500);
  });

  it('uses a quarter of the cold rent otherwise', () => {
    expect(estimateNebenkostenCents(80_000)).toBe(20_000);
    expect(estimateNebenkostenCents(80_000, null)).toBe(20_000);
  });
});
