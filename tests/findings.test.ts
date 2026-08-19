/**
 * Was nach einem Suchlauf gemeldet wird.
 *
 * Die Hälfte dieser Tests prüft, wann *nicht* gemeldet wird. Eine nächtliche
 * Suche findet regelmäßig dreistellige Zahlen von Anzeigen; eine Meldung je
 * Anzeige wäre am Morgen ein Posteingang, den niemand durchsieht — und damit
 * genauso gut wie keine Meldung.
 */

import { describe, expect, it } from 'vitest';
import { findingsToNotices, type CandidateFindings } from '@/domain/findings';

function found(patch: Partial<CandidateFindings> = {}): CandidateFindings {
  return {
    candidateCaseId: 'c1',
    displayName: 'Tanvi Gupta',
    added: 0,
    withPhone: 0,
    ...patch,
  };
}

describe('Meldungen nach einem Suchlauf', () => {
  it('macht eine Meldung je Fall, nicht je Anzeige', () => {
    const notices = findingsToNotices([found({ added: 12 })]);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe('Tanvi Gupta: 12 neue passende Wohnungen');
  });

  it('schweigt über Fälle, für die nichts Passendes dazukam', () => {
    // „Nichts gefunden" ist keine Nachricht. Dafür gibt es die
    // Stillstands-Warnung, und die meldet sich nach Tagen statt nach jedem
    // Durchlauf.
    expect(findingsToNotices([found({ added: 0 })])).toEqual([]);
  });

  it('stellt Telefonnummern in den Titel', () => {
    const [notice] = findingsToNotices([found({ added: 5, withPhone: 2 })]);
    expect(notice.title).toBe('Tanvi Gupta: 2 Wohnungen zum Anrufen');
    expect(notice.body).toMatch(/5 neue passende Wohnungen/);
    expect(notice.body).toMatch(/Anrufen bringt heute eine Antwort/);
    expect(notice.callable).toBe(true);
  });

  it('sortiert Anrufbares nach oben', () => {
    const notices = findingsToNotices([
      found({ candidateCaseId: 'viele', displayName: 'Ana', added: 40 }),
      found({ candidateCaseId: 'nummer', displayName: 'Zoe', added: 1, withPhone: 1 }),
    ]);
    expect(notices.map((n) => n.candidateCaseId)).toEqual(['nummer', 'viele']);
  });

  it('sortiert bei gleichem Rang nach Ausbeute', () => {
    // „Ana: 1 neue Wohnung" über „Zoe: 40 neue Wohnungen" wäre reine
    // Alphabetik und hätte mit Dringlichkeit nichts zu tun.
    const notices = findingsToNotices([
      found({ candidateCaseId: 'wenig', displayName: 'Ana', added: 1 }),
      found({ candidateCaseId: 'viel', displayName: 'Zoe', added: 40 }),
    ]);
    expect(notices.map((n) => n.candidateCaseId)).toEqual(['viel', 'wenig']);
  });

  it('bleibt zwischen zwei Durchläufen in derselben Reihenfolge', () => {
    const cases = [
      found({ candidateCaseId: 'b', displayName: 'Bea', added: 3 }),
      found({ candidateCaseId: 'a', displayName: 'Ana', added: 3 }),
    ];
    expect(findingsToNotices(cases).map((n) => n.candidateCaseId)).toEqual(['a', 'b']);
    expect(findingsToNotices([...cases].reverse()).map((n) => n.candidateCaseId)).toEqual(['a', 'b']);
  });

  it('verlinkt direkt auf das, was zu tun ist', () => {
    // Nicht auf die Fallübersicht: von der Ergebnisseite aus wird gearbeitet,
    // und ein Zwischenklick bringt nichts.
    const [notice] = findingsToNotices([found({ candidateCaseId: 'abc', added: 2 })]);
    expect(notice.url).toBe('/kandidat/abc/ergebnisse?tab=zu-kontaktieren');
  });

  it('sagt in der Einzahl „Wohnung"', () => {
    const [notice] = findingsToNotices([found({ added: 1 })]);
    expect(notice.title).toBe('Tanvi Gupta: 1 neue passende Wohnung');
  });
});
