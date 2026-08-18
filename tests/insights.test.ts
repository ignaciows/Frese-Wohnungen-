/**
 * Die zwei Auswertungen: steht ein Fall still, und wird überhaupt geantwortet.
 *
 * Beide sind Warnungen, und eine Warnung, die zu oft kommt, wird weggeklickt.
 * Die Hälfte der Tests hier prüft deshalb, wann *nicht* gewarnt wird.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STALLED,
  describeResponseRate,
  findStalledCases,
  responseRates,
  type AttemptOutcome,
  type CaseActivity,
} from '@/domain/insights';

const now = new Date('2026-08-18T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000);

function activity(patch: Partial<CaseActivity> = {}): CaseActivity {
  return {
    candidateCaseId: 'c1',
    displayName: 'Tanvi Gupta',
    usableNow: 0,
    lastUsableAt: daysAgo(30),
    moveInDate: null,
    ...patch,
  };
}

describe('Fälle, die stillstehen', () => {
  it('meldet einen Fall, für den seit über einer Woche nichts nachkam', () => {
    const [stalled] = findStalledCases([activity({ lastUsableAt: daysAgo(12) })], now);
    expect(stalled.daysQuiet).toBe(12);
    expect(stalled.reason).toMatch(/12 Tagen/);
  });

  it('schweigt, solange noch anschreibbare Wohnungen offen sind', () => {
    // Das ist Rückstand, kein Stillstand — dort liegt Arbeit, sie ist nur
    // nicht getan. Eine Warnung wäre hier schlicht falsch.
    const cases = [activity({ usableNow: 4, lastUsableAt: daysAgo(30) })];
    expect(findStalledCases(cases, now)).toEqual([]);
  });

  it('schweigt innerhalb der Ruhefrist', () => {
    // Ein ruhiges Wochenende ist kein Stillstand.
    expect(findStalledCases([activity({ lastUsableAt: daysAgo(3) })], now)).toEqual([]);
  });

  it('meldet einen Fall, der noch nie einen Treffer hatte', () => {
    const [stalled] = findStalledCases([activity({ lastUsableAt: null })], now);
    expect(stalled.daysQuiet).toBeNull();
    expect(stalled.reason).toMatch(/Noch nie/);
  });

  it('macht Stillstand dringend, wenn die Anreise drückt', () => {
    const [stalled] = findStalledCases(
      [activity({ lastUsableAt: daysAgo(10), moveInDate: inDays(9) })],
      now,
    );
    expect(stalled.urgency).toBe('high');
    expect(stalled.reason).toMatch(/Anreise in 9 Tagen/);
  });

  it('sortiert dringend nach oben, dann die längste Stille', () => {
    const cases = [
      activity({ candidateCaseId: 'ruhig-lang', lastUsableAt: daysAgo(40) }),
      activity({ candidateCaseId: 'dringend', lastUsableAt: daysAgo(8), moveInDate: inDays(5) }),
      activity({ candidateCaseId: 'ruhig-kurz', lastUsableAt: daysAgo(9) }),
    ];
    expect(findStalledCases(cases, now).map((c) => c.candidateCaseId)).toEqual([
      'dringend',
      'ruhig-lang',
      'ruhig-kurz',
    ]);
  });

  it('hält sich an eine eigene Ruhefrist', () => {
    const cases = [activity({ lastUsableAt: daysAgo(4) })];
    expect(findStalledCases(cases, now, { ...DEFAULT_STALLED, quietDays: 3 })).toHaveLength(1);
    expect(findStalledCases(cases, now, { ...DEFAULT_STALLED, quietDays: 14 })).toHaveLength(0);
  });
});

describe('Antwortquote', () => {
  const attempt = (sourceName: string, outcome: string): AttemptOutcome => ({
    sourceName,
    outcome,
    contactedAt: daysAgo(10),
  });

  it('zählt alles außer „warten wir noch" als Antwort', () => {
    // Auch eine Absage ist eine Antwort. Gemessen wird, ob jemand reagiert,
    // nicht ob es gut ausging.
    const { overall } = responseRates([
      attempt('Kleinanzeigen', 'AWAITING'),
      attempt('Kleinanzeigen', 'DECLINED'),
      attempt('Kleinanzeigen', 'VIEWING_OFFERED'),
      attempt('Kleinanzeigen', 'AWAITING'),
      attempt('Kleinanzeigen', 'NO_RESPONSE'),
    ]);
    expect(overall.sent).toBe(5);
    expect(overall.answered).toBe(3);
    expect(overall.ratePercent).toBe(60);
  });

  it('nennt keine Quote, solange es zu wenige Anfragen sind', () => {
    // Aus zwei Anfragen sind 0 % oder 50 % — beides heißt nichts, und nach
    // beidem würde jemand eine Quelle abschalten.
    const { overall, perSource } = responseRates([
      attempt('Immowelt', 'AWAITING'),
      attempt('Immowelt', 'DECLINED'),
    ]);
    expect(overall.ratePercent).toBeNull();
    expect(perSource[0].ratePercent).toBeNull();
    expect(perSource[0].sent).toBe(2);
  });

  it('trennt die Quellen und sortiert nach Menge', () => {
    const { perSource } = responseRates([
      attempt('Kleinanzeigen', 'DECLINED'),
      attempt('Kleinanzeigen', 'AWAITING'),
      attempt('ImmoScout24', 'AWAITING'),
    ]);
    expect(perSource.map((r) => r.sourceName)).toEqual(['Kleinanzeigen', 'ImmoScout24']);
  });

  it('sagt deutlich, wenn gar nichts beantwortet wird', () => {
    const { overall } = responseRates(
      Array.from({ length: 8 }, () => attempt('Kleinanzeigen', 'AWAITING')),
    );
    expect(overall.ratePercent).toBe(0);
    expect(describeResponseRate(overall)).toMatch(/liegt fast nie am Markt/);
  });

  it('bleibt still, solange nichts verschickt wurde', () => {
    const { overall } = responseRates([]);
    expect(describeResponseRate(overall)).toBeNull();
  });
});
