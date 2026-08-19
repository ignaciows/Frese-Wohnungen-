/**
 * Was nach einem Suchlauf gemeldet wird — und was nicht.
 *
 * Die nächtliche Suche findet regelmäßig dreistellige Zahlen von Anzeigen. Eine
 * Meldung je Anzeige wäre am Morgen ein Posteingang, den niemand durchsieht,
 * und damit genauso gut wie keine Meldung. Deshalb hier zwei Regeln:
 *
 *  1. **Eine Meldung je Fall, nicht je Anzeige.** „4 neue passende Wohnungen"
 *     ist eine Nachricht; vier Nachrichten sind Lärm.
 *  2. **Gemeldet wird nur, was jemand anfassen kann.** Eine Anzeige, die nicht
 *     zum Profil passt, ist kein Ereignis — sie ist der Normalfall. Drei
 *     Viertel jedes Suchlaufs sind das.
 *
 * Telefonnummern stehen in der Meldung vorn, aus demselben Grund wie in der
 * Tagesliste: dort ist eine Antwort noch heute möglich, und morgen ist die
 * Anzeige weg.
 */

export interface CandidateFindings {
  candidateCaseId: string;
  displayName: string;
  /** Neue passende Wohnungen seit dem letzten Blick. */
  added: number;
  /** Davon welche mit einer Telefonnummer im Anzeigentext. */
  withPhone: number;
}

export interface Finding {
  candidateCaseId: string;
  /** Wie viele passende Wohnungen dazukamen — entscheidet die Reihenfolge. */
  added: number;
  title: string;
  body: string;
  url: string;
  /** Es gibt etwas zum Anrufen — das ist die Meldung, die heute noch zählt. */
  callable: boolean;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Meldungen für einen Suchlauf, dringendste zuerst.
 *
 * Fälle ohne neue passende Wohnung kommen nicht vor. „Nichts gefunden" ist
 * keine Nachricht — dafür gibt es die Stillstands-Warnung, und die meldet sich
 * nach Tagen und nicht nach jedem Durchlauf.
 */
export function findingsToNotices(findings: CandidateFindings[]): Finding[] {
  const out: Finding[] = [];

  for (const f of findings) {
    if (f.added <= 0) continue;

    const callable = f.withPhone > 0;
    out.push({
      candidateCaseId: f.candidateCaseId,
      added: f.added,
      title: callable
        ? `${f.displayName}: ${plural(f.withPhone, 'Wohnung', 'Wohnungen')} zum Anrufen`
        : `${f.displayName}: ${plural(f.added, 'neue passende Wohnung', 'neue passende Wohnungen')}`,
      body: callable
        ? `${plural(f.added, 'neue passende Wohnung', 'neue passende Wohnungen')}, davon ${f.withPhone} mit Telefonnummer im Anzeigentext. Anrufen bringt heute eine Antwort — schreiben frühestens morgen.`
        : `${plural(f.added, 'neue passende Wohnung', 'neue passende Wohnungen')} seit dem letzten Suchlauf.`,
      url: `/kandidat/${f.candidateCaseId}/ergebnisse?tab=zu-kontaktieren`,
      callable,
    });
  }

  // Erst die mit Nummer, dann die größte Ausbeute. Bei Gleichstand der Titel,
  // damit zwei Durchläufe dieselbe Reihenfolge ergeben.
  return out.sort((a, b) => {
    if (a.callable !== b.callable) return a.callable ? -1 : 1;
    return b.added - a.added || a.title.localeCompare(b.title, 'de');
  });
}
