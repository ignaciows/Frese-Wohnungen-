import { describe, expect, it } from 'vitest';
import {
  computeCandidatePriority,
  computeMarketDifficulty,
  regionKeyFor,
  smoothedPositiveRate,
  targetAnfragen,
  PRIORITY_CONFIG,
  type MarketDifficulty,
} from '@/domain/priority';

const NO_DATA = { contactsSent: 0, positiveResponses: 0, listingsImported: 0, searchRuns: 0 };
const NOW = new Date('2026-08-10T12:00:00Z');
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

function market(over: Partial<MarketDifficulty> = {}): MarketDifficulty {
  return {
    difficulty: 50,
    confidence: 0,
    expectedPositiveRate: PRIORITY_CONFIG.priorPositiveRate,
    listingsPerRun: null,
    reasons: [],
    ...over,
  };
}

describe('smoothed success rate', () => {
  it('returns the prior when there is no data', () => {
    expect(smoothedPositiveRate(0, 0)).toBeCloseTo(PRIORITY_CONFIG.priorPositiveRate, 5);
  });

  it('barely moves on a tiny sample', () => {
    // 1 positive out of 2 is not evidence of a 50% market.
    const r = smoothedPositiveRate(1, 2);
    expect(r).toBeLessThan(0.25);
  });

  it('converges on the observed rate with enough data', () => {
    const r = smoothedPositiveRate(60, 200);
    expect(r).toBeGreaterThan(0.27);
    expect(r).toBeLessThan(0.31);
  });

  it('a long run of failures drags the rate down', () => {
    expect(smoothedPositiveRate(0, 100)).toBeLessThan(0.03);
  });
});

describe('market difficulty', () => {
  it('uses the seed when nothing has been measured', () => {
    const m = computeMarketDifficulty({ seededDifficulty: 90, seedNote: 'Großstadt' }, NO_DATA);
    expect(m.difficulty).toBe(90);
    expect(m.confidence).toBe(0);
    expect(m.reasons[0]).toContain('Startschätzung');
  });

  it('shifts towards observed data as contacts accumulate', () => {
    const seed = { seededDifficulty: 20, seedNote: 'angeblich einfach' };
    // Reality: 40 Anfragen, no positive replies at all → very hard.
    const m = computeMarketDifficulty(seed, {
      ...NO_DATA,
      contactsSent: 40,
      positiveResponses: 0,
    });
    expect(m.confidence).toBeGreaterThan(0.7);
    expect(m.difficulty).toBeGreaterThan(70);
  });

  it('a good measured rate lowers difficulty below a pessimistic seed', () => {
    const m = computeMarketDifficulty({ seededDifficulty: 85, seedNote: 'x' }, {
      contactsSent: 60,
      positiveResponses: 24,
      listingsImported: 200,
      searchRuns: 10,
    });
    expect(m.difficulty).toBeLessThan(50);
  });

  it('treats scarcity as hard even when the response rate is fine', () => {
    // Middle of nowhere: people answer, but there is almost nothing to answer to.
    const scarce = computeMarketDifficulty({ seededDifficulty: 50, seedNote: 'x' }, {
      contactsSent: 30,
      positiveResponses: 9, // 30% — a healthy rate
      listingsImported: 6,
      searchRuns: 6, // only 1 listing per run
    });
    expect(scarce.listingsPerRun).toBeCloseTo(1, 5);
    expect(scarce.difficulty).toBeGreaterThan(60);
    expect(scarce.reasons.some((r) => r.includes('wenig Angebot'))).toBe(true);
  });

  it('a healthy market with plenty of supply scores easy', () => {
    const m = computeMarketDifficulty({ seededDifficulty: 50, seedNote: 'x' }, {
      contactsSent: 50,
      positiveResponses: 18,
      listingsImported: 150,
      searchRuns: 10,
    });
    expect(m.difficulty).toBeLessThan(40);
  });
});

describe('Anfrage target', () => {
  it('needs more Anfragen when the success rate is low', () => {
    const hard = targetAnfragen(0.05);
    const easy = targetAnfragen(0.4);
    expect(hard).toBeGreaterThan(easy);
  });

  it('stays inside the guardrails', () => {
    expect(targetAnfragen(0.0001)).toBe(PRIORITY_CONFIG.maxTargetContacts);
    expect(targetAnfragen(1)).toBe(PRIORITY_CONFIG.minTargetContacts);
  });
});

describe('candidate priority', () => {
  const base = {
    searchStartedAt: daysFromNow(-10),
    moveInDate: daysFromNow(60),
    contactsSent: 5,
    positiveResponses: 0,
    settled: false,
    market: market(),
    now: NOW,
  };

  it('an imminent move-in outranks a distant one', () => {
    const soon = computeCandidatePriority({ ...base, moveInDate: daysFromNow(10) });
    const later = computeCandidatePriority({ ...base, moveInDate: daysFromNow(80) });
    expect(soon.score).toBeGreaterThan(later.score);
  });

  it('an overdue move-in is maximum deadline pressure', () => {
    const r = computeCandidatePriority({ ...base, moveInDate: daysFromNow(-3) });
    expect(r.components.deadline).toBe(100);
    expect(r.reasons.some((x) => x.includes('überschritten'))).toBe(true);
  });

  it('waiting longer since the contract raises priority', () => {
    const fresh = computeCandidatePriority({ ...base, searchStartedAt: daysFromNow(-1) });
    const stale = computeCandidatePriority({ ...base, searchStartedAt: daysFromNow(-40) });
    expect(stale.score).toBeGreaterThan(fresh.score);
    expect(stale.daysWaiting).toBe(40);
  });

  it('a harder market raises priority and the Anfrage target', () => {
    const easy = computeCandidatePriority({
      ...base,
      market: market({ difficulty: 20, expectedPositiveRate: 0.35 }),
    });
    const hard = computeCandidatePriority({
      ...base,
      market: market({ difficulty: 95, expectedPositiveRate: 0.04 }),
    });
    expect(hard.score).toBeGreaterThan(easy.score);
    expect(hard.targetContacts).toBeGreaterThan(easy.targetContacts);
  });

  it('the remote/low-supply case gets a big Anfrage target', () => {
    const remote = computeCandidatePriority({
      ...base,
      market: market({ difficulty: 88, expectedPositiveRate: 0.06 }),
    });
    expect(remote.targetContacts).toBeGreaterThanOrEqual(30);
    expect(remote.remainingContacts).toBeGreaterThan(20);
  });

  it('positive replies reduce urgency without zeroing it', () => {
    const none = computeCandidatePriority({ ...base, positiveResponses: 0 });
    const some = computeCandidatePriority({ ...base, positiveResponses: 2 });
    expect(some.score).toBeLessThan(none.score);
    expect(some.score).toBeGreaterThan(0);
  });

  it('a secured flat drops out of the queue entirely', () => {
    const r = computeCandidatePriority({ ...base, settled: true, moveInDate: daysFromNow(2) });
    expect(r.score).toBe(0);
    expect(r.tier).toBe('LOW');
    expect(r.reasons[0]).toContain('gesichert');
  });

  it('scores stay within 0..100 for extreme inputs', () => {
    const r = computeCandidatePriority({
      ...base,
      searchStartedAt: daysFromNow(-400),
      moveInDate: daysFromNow(-100),
      contactsSent: 0,
      market: market({ difficulty: 100, expectedPositiveRate: 0.01 }),
    });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.tier).toBe('CRITICAL');
  });

  it('explains itself', () => {
    const r = computeCandidatePriority({ ...base, moveInDate: daysFromNow(12), contactsSent: 2 });
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.some((x) => x.includes('Anfragen'))).toBe(true);
  });

  it('is deterministic', () => {
    const a = computeCandidatePriority(base);
    const b = computeCandidatePriority(base);
    expect(a.score).toBe(b.score);
  });
});

describe('region keys', () => {
  it('groups by postal prefix', () => {
    expect(regionKeyFor('74906', 'Bad Rappenau')).toBe('749');
    expect(regionKeyFor('74072', 'Heilbronn')).toBe('740');
  });
  it('falls back to city when the postcode is missing', () => {
    expect(regionKeyFor(null, 'Heilbronn')).toBe('city:heilbronn');
  });
  it('returns null when nothing is known', () => {
    expect(regionKeyFor(null, null)).toBeNull();
  });
});
