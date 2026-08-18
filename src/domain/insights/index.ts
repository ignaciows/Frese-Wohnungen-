/**
 * Die zwei Fragen, die niemand stellt, bis es zu spät ist.
 *
 * Die App beantwortet gut, *welche Wohnung als nächstes*. Sie beantwortet
 * bisher nicht, ob die Suche für einen Fall überhaupt noch etwas hergibt, und
 * ob das Anschreiben funktioniert. Beides merkt man sonst erst, wenn jemand
 * in drei Wochen anreist und nichts hat.
 *
 *  1. **Steht ein Fall still?** Nicht „hat er Treffer", sondern „war in den
 *     letzten Tagen etwas Anschreibbares dabei". Ein Fall mit 200 Anzeigen,
 *     von denen keine passt, sieht auf jeder Liste beschäftigt aus und ist es
 *     nicht.
 *  2. **Wird geantwortet?** Wenn von vierzig Anfragen keine beantwortet wird,
 *     liegt es am Anschreiben oder an der Quelle — und nicht daran, dass „der
 *     Markt schwierig ist". Ohne Zahl bleibt es ein Gefühl.
 *
 * Alles hier ist rein: rein, gerechnet, raus. Kein Prisma, kein `new Date()`
 * ohne Parameter — damit jeder Fall als Tabelle prüfbar ist.
 */

/* ------------------------------------------------- Fälle, die stehen --- */

export interface CaseActivity {
  candidateCaseId: string;
  displayName: string;
  /** Wann zuletzt eine anschreibbare Wohnung dazukam. Null = noch nie. */
  lastUsableAt: Date | null;
  /** Wie viele anschreibbare Wohnungen gerade offen sind. */
  usableNow: number;
  /** Wann die Kandidatin anreist, falls bekannt — macht Stillstand dringend. */
  moveInDate: Date | null;
}

export interface StalledCase extends CaseActivity {
  /** Tage seit dem letzten brauchbaren Treffer. Null = noch nie einen gehabt. */
  daysQuiet: number | null;
  /** Warum das auffällt, in einem Satz für den Bildschirm. */
  reason: string;
  /** `high`, wenn zusätzlich die Anreise drückt. */
  urgency: 'high' | 'normal';
}

export interface StalledSettings {
  /** Ab so vielen Tagen ohne brauchbaren Treffer gilt ein Fall als stehend. */
  quietDays: number;
  /** Anreise in weniger als so vielen Tagen macht denselben Stillstand dringend. */
  urgentWithinDays: number;
}

export const DEFAULT_STALLED: StalledSettings = {
  // Eine Woche: kürzer, und ein ruhiges Wochenende schlägt schon Alarm.
  quietDays: 7,
  // Drei Wochen vor der Anreise ist eine Wohnung zu suchen noch machbar.
  urgentWithinDays: 21,
};

const DAY = 86_400_000;

/** Volle Tage zwischen zwei Zeitpunkten, nie negativ. */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));
}

/**
 * Welche Fälle stehen — sortiert, dringendste zuerst.
 *
 * Ein Fall mit offenen anschreibbaren Wohnungen steht nicht still, egal wie
 * alt die sind: dort liegt Arbeit, sie ist nur nicht getan. Gemeint ist der
 * andere Fall, wo nichts nachkommt.
 */
export function findStalledCases(
  cases: CaseActivity[],
  now: Date,
  settings: StalledSettings = DEFAULT_STALLED,
): StalledCase[] {
  const out: StalledCase[] = [];

  for (const c of cases) {
    // Es liegt Arbeit da — das ist kein Stillstand, sondern ein Rückstand.
    if (c.usableNow > 0) continue;

    const daysQuiet = c.lastUsableAt ? daysBetween(c.lastUsableAt, now) : null;
    if (daysQuiet !== null && daysQuiet < settings.quietDays) continue;

    const daysToArrival = c.moveInDate ? daysBetween(now, c.moveInDate) : null;
    const urgent = daysToArrival !== null && daysToArrival <= settings.urgentWithinDays;

    out.push({
      ...c,
      daysQuiet,
      urgency: urgent ? 'high' : 'normal',
      reason:
        daysQuiet === null
          ? 'Noch nie eine passende Wohnung dabei — meistens ist das Suchprofil zu eng.'
          : `Seit ${daysQuiet} Tagen nichts Passendes mehr. ${
              urgent && daysToArrival !== null
                ? `Anreise in ${daysToArrival} Tagen.`
                : 'Budget, Umkreis oder Zimmerzahl prüfen.'
            }`,
    });
  }

  // Dringend zuerst, dann die längste Stille. Ein „noch nie" gilt als am
  // längsten still, weil dort noch gar nichts funktioniert hat.
  return out.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === 'high' ? -1 : 1;
    return (b.daysQuiet ?? Number.MAX_SAFE_INTEGER) - (a.daysQuiet ?? Number.MAX_SAFE_INTEGER);
  });
}

/* --------------------------------------------------- Antwortquote ----- */

export interface AttemptOutcome {
  sourceName: string;
  /** AWAITING, solange niemand eine Antwort erfasst hat. */
  outcome: string;
  contactedAt: Date;
}

export interface ResponseRate {
  sourceName: string;
  sent: number;
  answered: number;
  /** 0–100, oder null solange zu wenige Anfragen für eine Aussage da sind. */
  ratePercent: number | null;
}

/**
 * Wie viele Anfragen beantwortet werden, je Quelle.
 *
 * `minimumForRate` gibt es, weil eine Quote aus zwei Anfragen entweder 0 % oder
 * 50 % ist und beides nichts heißt. Unter der Schwelle steht die Zahl da, aber
 * ohne Prozentwert — lieber „zu wenig Daten" als eine Zahl, nach der jemand
 * eine Quelle abschaltet.
 */
export function responseRates(
  attempts: AttemptOutcome[],
  options: { minimumForRate?: number } = {},
): { perSource: ResponseRate[]; overall: ResponseRate } {
  const minimum = options.minimumForRate ?? 5;
  const bySource = new Map<string, { sent: number; answered: number }>();

  for (const a of attempts) {
    const entry = bySource.get(a.sourceName) ?? { sent: 0, answered: 0 };
    entry.sent += 1;
    // Alles außer „warten wir noch" zählt als Antwort — auch eine Absage.
    // Gemessen wird, ob überhaupt jemand reagiert, nicht ob es gut ausging.
    if (a.outcome !== 'AWAITING') entry.answered += 1;
    bySource.set(a.sourceName, entry);
  }

  const rate = (sent: number, answered: number) =>
    sent >= minimum ? Math.round((answered / sent) * 100) : null;

  const perSource = [...bySource.entries()]
    .map(([sourceName, v]) => ({ sourceName, ...v, ratePercent: rate(v.sent, v.answered) }))
    .sort((a, b) => b.sent - a.sent);

  const sent = attempts.length;
  const answered = attempts.filter((a) => a.outcome !== 'AWAITING').length;

  return {
    perSource,
    overall: { sourceName: 'Gesamt', sent, answered, ratePercent: rate(sent, answered) },
  };
}

/**
 * Ein Satz zur Gesamtquote — oder null, wenn es nichts zu sagen gibt.
 *
 * Die Schwellen sind bewusst grob. Was eine gute Quote ist, hängt an Stadt und
 * Jahreszeit; was hier zählt, ist der Unterschied zwischen „läuft" und
 * „irgendetwas stimmt nicht".
 */
export function describeResponseRate(overall: ResponseRate): string | null {
  if (overall.ratePercent === null) {
    return overall.sent > 0
      ? `${overall.sent} Anfrage(n) verschickt — für eine Quote noch zu wenige.`
      : null;
  }
  if (overall.ratePercent === 0) {
    return `Keine einzige von ${overall.sent} Anfragen wurde beantwortet. Das liegt fast nie am Markt — Anschreiben und Absenderadresse prüfen.`;
  }
  if (overall.ratePercent < 15) {
    return `${overall.ratePercent} % der Anfragen werden beantwortet. Wenig — ein kürzeres, persönlicheres Anschreiben ist der übliche Hebel.`;
  }
  return `${overall.ratePercent} % der Anfragen werden beantwortet (${overall.answered} von ${overall.sent}).`;
}
