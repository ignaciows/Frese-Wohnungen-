/**
 * Die Tagesliste: in welcher Reihenfolge die Fälle heute drankommen.
 *
 * Die App beantwortete bisher zwei Fragen gut — *welche Wohnung* für einen
 * Fall, und *welcher Fall* ist dringend. Sie beantwortete nicht die Frage, mit
 * der ein Arbeitstag anfängt: **womit fange ich an?** Wer das aus einer nach
 * Dringlichkeit sortierten Kandidatenliste selbst ableiten muss, fängt jeden
 * Morgen mit derselben Rechnung an.
 *
 * Die Reihenfolge folgt einer einzigen Beobachtung: **eine Telefonnummer ist
 * nicht dasselbe wie eine Adresse.** Wer anruft, hat in zehn Minuten eine
 * Antwort; wer schreibt, hat sie am Donnerstag oder nie. Eine Wohnung mit
 * Nummer ist deshalb keine dringendere Aufgabe derselben Art, sondern eine
 * andere Art von Aufgabe — und steht oben, unabhängig vom Punktestand.
 *
 * Darunter zählt wieder die normale Dringlichkeit: Anreisedatum, Wartezeit
 * seit Vertragsunterschrift, Schwierigkeit des Zielmarkts, Rückstand an
 * Anfragen. Das rechnet `domain/priority` und wird hier nur einsortiert.
 *
 * Rein: rein, gerechnet, raus. Kein Prisma, kein `new Date()` ohne Parameter.
 */

import type { PriorityTier } from '@/domain/priority';

/** Was heute für diesen Fall zu tun ist. */
export type WorkKind =
  /** Es gibt Wohnungen mit Telefonnummer — anrufen. */
  | 'CALL'
  /** Passende Wohnungen ohne Nummer — anschreiben. */
  | 'WRITE'
  /** Nichts Anschreibbares offen. Nicht „fertig", sondern „hier fehlt Nachschub". */
  | 'IDLE';

export interface CaseWork {
  candidateCaseId: string;
  displayName: string;
  /** Klinik, Pflegeheim, Träger — macht den Fall ohne Nachschlagen einordenbar. */
  employer: string | null;
  /** Punktestand aus `domain/priority`, 0..100. */
  priorityScore: number;
  tier: PriorityTier;
  /** Tage bis zur Anreise, falls bekannt. Negativ = Termin ist vorbei. */
  daysUntilMoveIn: number | null;
  /** Wie viele Anfragen bis zum realistischen Ziel noch fehlen. */
  remainingContacts: number;
  /** Offene passende Wohnungen, die eine Telefonnummer nennen. */
  callable: number;
  /** Offene passende Wohnungen ohne Nummer. */
  writable: number;
}

export interface WorkItem extends CaseWork {
  kind: WorkKind;
  /** Was zu tun ist, in einer Zeile. */
  action: string;
  /** Warum dieser Fall hier steht — oder null, wenn es nichts zu sagen gibt. */
  why: string | null;
}

export interface Worklist {
  /** Zuerst anrufen. */
  call: WorkItem[];
  /** Dann anschreiben. */
  write: WorkItem[];
  /** Fälle ohne offene Wohnung — dort ist heute nichts zu holen. */
  idle: WorkItem[];
  /** Wohnungen mit Nummer über alle Fälle. */
  totalCallable: number;
  /**
   * Offene Wohnungen ohne Nummer, **über alle Fälle** — auch die im
   * Anruf-Block, wo neben den Nummern noch anschreibbare liegen. Also nicht
   * die Größe des „Dann anschreiben"-Blocks; der Satz oben sagt das mit
   * „weitere" auch so.
   */
  totalWritable: number;
}

/** Ab hier drückt die Anreise so, dass es in der Zeile stehen muss. */
const ARRIVAL_URGENT_DAYS = 21;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Warum dieser Fall an dieser Stelle steht.
 *
 * Höchstens zwei Gründe. Eine Zeile mit fünf Begründungen wird nicht gelesen,
 * und der dritte Grund hat die Reihenfolge ohnehin nicht mehr entschieden.
 */
function reasonFor(c: CaseWork): string | null {
  const out: string[] = [];

  if (c.daysUntilMoveIn != null) {
    if (c.daysUntilMoveIn < 0) out.push(`Anreisetermin seit ${Math.abs(c.daysUntilMoveIn)} Tagen vorbei`);
    else if (c.daysUntilMoveIn === 0) out.push('Anreise heute');
    else if (c.daysUntilMoveIn <= ARRIVAL_URGENT_DAYS) out.push(`Anreise in ${c.daysUntilMoveIn} Tagen`);
  }

  if (out.length < 2 && c.remainingContacts > 0) {
    out.push(`${plural(c.remainingContacts, 'Anfrage fehlt', 'Anfragen fehlen')} zum Ziel`);
  }

  if (out.length === 0 && c.tier === 'CRITICAL') out.push('Höchste Dringlichkeit');

  return out.length > 0 ? out.join(' · ') : null;
}

function actionFor(c: CaseWork, kind: WorkKind): string {
  if (kind === 'CALL') {
    const rest =
      c.writable > 0 ? `, dazu ${plural(c.writable, 'zum Anschreiben', 'zum Anschreiben')}` : '';
    return `${plural(c.callable, 'Wohnung mit Telefonnummer', 'Wohnungen mit Telefonnummer')}${rest}`;
  }
  if (kind === 'WRITE') {
    return plural(c.writable, 'Wohnung zum Anschreiben', 'Wohnungen zum Anschreiben');
  }
  return 'Nichts Offenes — Suchprofil prüfen';
}

/**
 * Die Tagesliste aus den Fällen bauen.
 *
 * Innerhalb jedes Blocks entscheidet der Punktestand aus `domain/priority`;
 * bei Gleichstand der Name, damit die Reihenfolge zwischen zwei Aufrufen
 * gleich bleibt und niemand sucht, wohin ein Fall gesprungen ist.
 */
export function buildWorklist(cases: CaseWork[]): Worklist {
  const byUrgency = (a: WorkItem, b: WorkItem) =>
    b.priorityScore - a.priorityScore || a.displayName.localeCompare(b.displayName, 'de');

  const toItem = (c: CaseWork, kind: WorkKind): WorkItem => ({
    ...c,
    kind,
    action: actionFor(c, kind),
    why: reasonFor(c),
  });

  const call: WorkItem[] = [];
  const write: WorkItem[] = [];
  const idle: WorkItem[] = [];

  for (const c of cases) {
    // Eine Nummer schlägt jeden Punktestand: das ist der einzige Weg zu einer
    // Antwort am selben Tag, und er ist morgen weg.
    if (c.callable > 0) call.push(toItem(c, 'CALL'));
    else if (c.writable > 0) write.push(toItem(c, 'WRITE'));
    else idle.push(toItem(c, 'IDLE'));
  }

  return {
    call: call.sort(byUrgency),
    write: write.sort(byUrgency),
    idle: idle.sort(byUrgency),
    totalCallable: cases.reduce((n, c) => n + c.callable, 0),
    totalWritable: cases.reduce((n, c) => n + c.writable, 0),
  };
}

/**
 * Ein Satz über den Tag — oder null, wenn es nichts zu sagen gibt.
 *
 * Bewusst eine Zahl und keine Aufmunterung: „Alles erledigt" wäre gelogen,
 * solange Fälle ohne Nachschub dastehen.
 */
export function describeWorklist(list: Worklist): string | null {
  const parts: string[] = [];
  if (list.call.length > 0) {
    parts.push(
      `${plural(list.totalCallable, 'Wohnung', 'Wohnungen')} mit Telefonnummer bei ${plural(list.call.length, 'Fall', 'Fällen')}`,
    );
  }
  if (list.totalWritable > 0) {
    // „weitere", weil hier auch die anschreibbaren Wohnungen der Fälle aus dem
    // Anruf-Block mitzählen. Ohne das Wort liest sich die Zahl wie die Größe
    // des Blocks darunter, und die ist kleiner.
    parts.push(
      list.call.length > 0
        ? `${plural(list.totalWritable, 'weitere Wohnung', 'weitere Wohnungen')} zum Anschreiben`
        : `${plural(list.totalWritable, 'Wohnung', 'Wohnungen')} zum Anschreiben`,
    );
  }
  if (parts.length === 0) {
    return list.idle.length > 0
      ? 'Für keinen Fall ist gerade eine passende Wohnung offen. Das ist kein Feierabend, sondern ein Hinweis auf die Suchprofile.'
      : null;
  }
  return `${parts.join(' · ')}.`;
}
