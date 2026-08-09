import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRIDGING,
  DEFAULT_FRESHNESS,
  evaluateFreshness,
  evaluateMoveInTiming,
  firstPeriodCostCents,
} from '@/domain/timing';

const NOW = new Date('2026-08-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const d = (iso: string) => new Date(iso);

describe('freshness', () => {
  it('marks a listing seen an hour ago as NEW', () => {
    const r = evaluateFreshness({ firstSeenAt: hoursAgo(1), lastSeenAt: null, expired: false }, DEFAULT_FRESHNESS, NOW);
    expect(r.state).toBe('NEW');
    expect(r.scoreFactor).toBe(1);
  });

  it('stops being NEW after the configured window', () => {
    const r = evaluateFreshness({ firstSeenAt: hoursAgo(30), lastSeenAt: null, expired: false }, DEFAULT_FRESHNESS, NOW);
    expect(r.state).not.toBe('NEW');
  });

  it('goes STALE past the threshold and loses score', () => {
    const r = evaluateFreshness({ firstSeenAt: daysAgo(30), lastSeenAt: null, expired: false }, DEFAULT_FRESHNESS, NOW);
    expect(r.state).toBe('STALE');
    expect(r.scoreFactor).toBeLessThan(1);
    expect(r.label).toContain('vergeben');
  });

  it('an expired listing is EXPIRED regardless of age', () => {
    const r = evaluateFreshness({ firstSeenAt: hoursAgo(1), lastSeenAt: null, expired: true }, DEFAULT_FRESHNESS, NOW);
    expect(r.state).toBe('EXPIRED');
    expect(r.scoreFactor).toBe(0);
  });

  it('being seen again resets the age', () => {
    const old = { firstSeenAt: daysAgo(40), lastSeenAt: hoursAgo(2), expired: false };
    const r = evaluateFreshness(old, DEFAULT_FRESHNESS, NOW);
    expect(r.state).toBe('NEW');
  });

  it('respects a custom stale threshold', () => {
    const strict = { ...DEFAULT_FRESHNESS, staleAfterDays: 3 };
    const r = evaluateFreshness({ firstSeenAt: daysAgo(5), lastSeenAt: null, expired: false }, strict, NOW);
    expect(r.state).toBe('STALE');
  });
});

describe('move-in timing', () => {
  const arrival = d('2026-10-01T00:00:00Z');

  it('flat free exactly on arrival day', () => {
    const r = evaluateMoveInTiming(d('2026-10-01T00:00:00Z'), arrival, 80000);
    expect(r.verdict).toBe('READY_ON_TIME');
    expect(r.bridgeNights).toBe(0);
  });

  it('free a few days early is ideal — keys ready', () => {
    const r = evaluateMoveInTiming(d('2026-09-25T00:00:00Z'), arrival, 80000);
    expect(r.verdict).toBe('READY_BEFORE_ARRIVAL');
    expect(r.leadDays).toBe(6);
    expect(r.bridgeCostCents).toBe(0);
    expect(r.reasons[0]).toContain('vor Ankunft');
  });

  it('free very early counts the empty rent as a mild downside', () => {
    const r = evaluateMoveInTiming(d('2026-08-01T00:00:00Z'), arrival, 90000);
    expect(r.verdict).toBe('READY_BEFORE_ARRIVAL');
    expect(r.emptyRentDays).toBeGreaterThan(30);
    expect(r.scoreFactor).toBeLessThan(1);
  });

  it('the exact case asked for: arrival on the 1st, flat free on the 15th', () => {
    const r = evaluateMoveInTiming(d('2026-10-15T00:00:00Z'), arrival, 80000, {
      ...DEFAULT_BRIDGING,
      nightlyRateCents: 6500,
    });
    expect(r.verdict).toBe('BRIDGE_NEEDED');
    expect(r.bridgeNights).toBe(14);
    expect(r.bridgeCostCents).toBe(14 * 6500);
    expect(r.reasons[0]).toContain('Zwischenunterkunft');
  });

  it('never rules a listing out — it prices the gap instead', () => {
    const r = evaluateMoveInTiming(d('2026-12-01T00:00:00Z'), arrival, 80000);
    expect(r.verdict).toBe('BRIDGE_TOO_LONG');
    // Still scored, just lower: a great flat can be worth it.
    expect(r.scoreFactor).toBeGreaterThan(0);
  });

  it('flags a bridge beyond the configured maximum', () => {
    const r = evaluateMoveInTiming(d('2026-11-20T00:00:00Z'), arrival, 80000, {
      ...DEFAULT_BRIDGING,
      maxBridgeNights: 30,
    });
    expect(r.verdict).toBe('BRIDGE_TOO_LONG');
    expect(r.reasons.some((x) => x.includes('unwirtschaftlich'))).toBe(true);
  });

  it('reports UNKNOWN when the availability date is missing', () => {
    const r = evaluateMoveInTiming(null, arrival, 80000);
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.bridgeNights).toBe(0);
  });

  it('says so when no arrival date is set', () => {
    const r = evaluateMoveInTiming(d('2026-10-15T00:00:00Z'), null, 80000);
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.label).toContain('Ankunftsdatum');
  });

  it('scales the bridge cost with the configured nightly rate', () => {
    const cheap = evaluateMoveInTiming(d('2026-10-11T00:00:00Z'), arrival, 80000, {
      ...DEFAULT_BRIDGING,
      nightlyRateCents: 4000,
    });
    const pricey = evaluateMoveInTiming(d('2026-10-11T00:00:00Z'), arrival, 80000, {
      ...DEFAULT_BRIDGING,
      nightlyRateCents: 9000,
    });
    expect(pricey.bridgeCostCents).toBeGreaterThan(cheap.bridgeCostCents);
    expect(cheap.bridgeNights).toBe(pricey.bridgeNights);
  });

  it('a shorter gap scores better than a longer one', () => {
    const short = evaluateMoveInTiming(d('2026-10-05T00:00:00Z'), arrival, 80000);
    const long = evaluateMoveInTiming(d('2026-10-25T00:00:00Z'), arrival, 80000);
    expect(short.scoreFactor).toBeGreaterThan(long.scoreFactor);
  });
});

describe('first period cost', () => {
  it('adds the bridge to the first month of rent', () => {
    const t = evaluateMoveInTiming(d('2026-10-15T00:00:00Z'), d('2026-10-01T00:00:00Z'), 80000, {
      ...DEFAULT_BRIDGING,
      nightlyRateCents: 6500,
    });
    expect(firstPeriodCostCents(t, 80000)).toBe(80000 + 14 * 6500);
  });

  it('returns null when the rent is unknown', () => {
    const t = evaluateMoveInTiming(d('2026-10-15T00:00:00Z'), d('2026-10-01T00:00:00Z'), null);
    expect(firstPeriodCostCents(t, null)).toBeNull();
  });
});
