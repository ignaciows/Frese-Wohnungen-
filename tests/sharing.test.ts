import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARING_SETTINGS,
  evaluatePair,
  findSharingSuggestions,
  type SharingCandidate,
  type SharingSettings,
} from '@/domain/sharing';

const day = 86_400_000;
const base = new Date('2026-10-01T00:00:00Z');

function cand(over: Partial<SharingCandidate> = {}): SharingCandidate {
  return {
    id: 'a',
    reference: 'CAND-1',
    displayName: 'A',
    openToSharing: true,
    nationality: 'Indien',
    languages: 'Hindi, Englisch',
    moveInDate: base,
    regionKey: '740',
    workplaceCity: 'Heilbronn',
    maxWarmmieteCents: 90000,
    adults: 1,
    children: 0,
    housingSecured: false,
    ...over,
  };
}

const S: SharingSettings = { ...DEFAULT_SHARING_SETTINGS };

describe('sharing: consent and hard gates', () => {
  it('never pairs someone who did not agree', () => {
    const r = evaluatePair(cand(), cand({ id: 'b', openToSharing: false }), S);
    expect(r).toBeNull();
  });

  it('needs BOTH sides to agree', () => {
    const r = evaluatePair(cand({ openToSharing: false }), cand({ id: 'b' }), S);
    expect(r).toBeNull();
  });

  it('excludes candidates with children', () => {
    expect(evaluatePair(cand(), cand({ id: 'b', children: 1 }), S)).toBeNull();
  });

  it('excludes couples', () => {
    expect(evaluatePair(cand(), cand({ id: 'b', adults: 2 }), S)).toBeNull();
  });

  it('excludes someone who already has a flat', () => {
    expect(evaluatePair(cand(), cand({ id: 'b', housingSecured: true }), S)).toBeNull();
  });

  it('rejects move-in dates that are too far apart', () => {
    const far = cand({ id: 'b', moveInDate: new Date(base.getTime() + 60 * day) });
    expect(evaluatePair(cand(), far, S)).toBeNull();
  });

  it('rejects different regions when same-region is required', () => {
    expect(evaluatePair(cand(), cand({ id: 'b', regionKey: '805' }), S)).toBeNull();
  });

  it('allows different regions when the rule is switched off', () => {
    const loose = { ...S, requireSameRegion: false };
    const r = evaluatePair(cand(), cand({ id: 'b', regionKey: '805' }), loose);
    expect(r).not.toBeNull();
  });

  it('needs a move-in date on both sides', () => {
    expect(evaluatePair(cand(), cand({ id: 'b', moveInDate: null }), S)).toBeNull();
  });
});

describe('sharing: nationality rule is configurable', () => {
  it('SAME_ONLY blocks different origins', () => {
    const strict = { ...S, nationalityRule: 'SAME_ONLY' as const };
    expect(evaluatePair(cand(), cand({ id: 'b', nationality: 'Philippinen' }), strict)).toBeNull();
  });

  it('PREFER_SAME allows different origins but scores them lower', () => {
    const same = evaluatePair(cand(), cand({ id: 'b' }), S)!;
    const diff = evaluatePair(cand(), cand({ id: 'b', nationality: 'Philippinen', languages: 'Tagalog' }), S)!;
    expect(diff).not.toBeNull();
    expect(same.score).toBeGreaterThan(diff.score);
  });

  it('IGNORE gives no bonus for matching origin', () => {
    const ignore = { ...S, nationalityRule: 'IGNORE' as const, considerLanguages: false };
    const same = evaluatePair(cand(), cand({ id: 'b' }), ignore)!;
    const diff = evaluatePair(
      cand(),
      cand({ id: 'b', nationality: 'Philippinen' }),
      ignore,
    )!;
    expect(same.score).toBe(diff.score);
  });
});

describe('sharing: scoring', () => {
  it('same-day move-in beats a two-week gap', () => {
    const sameDay = evaluatePair(cand(), cand({ id: 'b' }), S)!;
    const gap = evaluatePair(
      cand(),
      cand({ id: 'b', moveInDate: new Date(base.getTime() + 14 * day) }),
      S,
    )!;
    expect(sameDay.score).toBeGreaterThan(gap.score);
  });

  it('reports the combined budget, which is the point of sharing', () => {
    const r = evaluatePair(cand(), cand({ id: 'b', maxWarmmieteCents: 85000 }), S)!;
    expect(r.combinedBudgetCents).toBe(175000);
    expect(r.reasons.some((x) => x.includes('Gemeinsames Budget'))).toBe(true);
  });

  it('suggests at least three rooms for two adults', () => {
    const r = evaluatePair(cand(), cand({ id: 'b' }), S)!;
    expect(r.suggestedMinRooms).toBe(3);
  });

  it('always explains itself', () => {
    const r = evaluatePair(cand(), cand({ id: 'b' }), S)!;
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('stores the pair with a stable id order', () => {
    const ab = evaluatePair(cand({ id: 'zzz' }), cand({ id: 'aaa' }), S)!;
    expect(ab.aId).toBe('aaa');
    expect(ab.bId).toBe('zzz');
  });

  it('respects the minimum score', () => {
    // A pair whose move-in dates are nearly the full window apart scores low.
    const weak = cand({ id: 'b', moveInDate: new Date(base.getTime() + 20 * day) });
    const withDefault = evaluatePair(cand(), weak, S)!;
    expect(withDefault).not.toBeNull();

    const picky = { ...S, minScore: withDefault.score + 1 };
    expect(evaluatePair(cand(), weak, picky)).toBeNull();
  });

  it('returns nothing when matching is disabled', () => {
    expect(evaluatePair(cand(), cand({ id: 'b' }), { ...S, enabled: false })).toBeNull();
  });
});

describe('sharing: pool', () => {
  it('finds the one plausible pair in a mixed pool', () => {
    const pool = [
      cand({ id: 'a' }),
      cand({ id: 'b' }),
      cand({ id: 'c', regionKey: '805', workplaceCity: 'München' }),
      cand({ id: 'd', openToSharing: false }),
    ];
    const out = findSharingSuggestions(pool, S);
    expect(out).toHaveLength(1);
    expect([out[0].aId, out[0].bId].sort()).toEqual(['a', 'b']);
  });

  it('never pairs a candidate with themselves', () => {
    const out = findSharingSuggestions([cand({ id: 'a' })], S);
    expect(out).toHaveLength(0);
  });

  it('sorts best first', () => {
    const pool = [
      cand({ id: 'a' }),
      cand({ id: 'b' }),
      cand({ id: 'c', moveInDate: new Date(base.getTime() + 20 * day) }),
    ];
    const out = findSharingSuggestions(pool, S);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
  });
});
