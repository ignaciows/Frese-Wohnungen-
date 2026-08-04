import { describe, expect, it } from 'vitest';
import { findDuplicates, type DuplicateCandidate } from '@/domain/duplicates';

const base: DuplicateCandidate = {
  id: 'a',
  canonicalUrl: 'https://a/1',
  sourceListingId: null,
  title: 'Möbliertes 2 Zimmer Apartment Fürfeld',
  locationRaw: '74906 Bad Rappenau-Fürfeld',
  effectiveMonthlyCents: 78000,
  rooms: 2,
  livingSpaceSqm: 55,
};

describe('duplicates', () => {
  it('identical canonical URL is a hard match', () => {
    const others = [{ ...base, id: 'b', canonicalUrl: 'https://a/1' }];
    const m = findDuplicates(base, others);
    expect(m).toHaveLength(1);
    expect(m[0].confidence).toBe(1);
  });

  it('same portal listing id is a hard match', () => {
    const target = { ...base, sourceListingId: 'is24:123' };
    const others = [{ ...base, id: 'b', canonicalUrl: 'https://b/2', sourceListingId: 'is24:123' }];
    const m = findDuplicates(target, others);
    expect(m).toHaveLength(1);
    expect(m[0].confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('does not match on weak fuzzy signals alone', () => {
    const other = {
      ...base,
      id: 'b',
      canonicalUrl: 'https://b/2',
      title: 'Ganz andere Wohnung',
      effectiveMonthlyCents: 50000,
      rooms: 3,
      livingSpaceSqm: 100,
    };
    const m = findDuplicates(base, [other]);
    expect(m).toHaveLength(0);
  });

  it('suspects a duplicate when title + location + price + rooms match', () => {
    const other = {
      ...base,
      id: 'b',
      canonicalUrl: 'https://b/2',
      // Same slug tokens: "moebliertes", "zimmer", "apartment", "fuerfeld"
      title: 'Möbliertes Apartment 2 Zimmer in Fürfeld',
    };
    const m = findDuplicates(base, [other]);
    expect(m.length).toBe(1);
    expect(m[0].confidence).toBeGreaterThanOrEqual(0.6);
    expect(m[0].reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('does not auto-destroy — it only returns a suggestion', () => {
    const other = { ...base, id: 'b', canonicalUrl: base.canonicalUrl };
    const m = findDuplicates(base, [other]);
    // Consumer decides what to do with the suggestion.
    expect(m[0].otherId).toBe('b');
  });
});
