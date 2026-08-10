/**
 * "Only show me ads posted in the last N days."
 *
 * The obvious implementation — filter on `importedAt` — measures our own
 * activity rather than the market's, and gets the answer wrong in the one
 * direction that costs a flat: an ad found in this morning's sweep can already
 * have been up for three weeks, and it looks brand new.
 *
 * So the filter runs on the best date available per ad, and says which one it
 * used. That honesty is the point: "posted 2 days ago (portal says so)" and
 * "we first saw it 2 days ago, the portal doesn't say" are different claims,
 * and a colleague deciding whether to write an Anfrage deserves to know which
 * one they are looking at.
 */

/** Where a listing's age came from, best first. */
export type AgeSource = 'PORTAL' | 'ALERT' | 'FIRST_SEEN' | 'UNKNOWN';

export interface AgeInput {
  /** Publication date printed by the ad itself. The gold standard. */
  postedAt: Date | null;
  /**
   * When a portal search-agent alert first told us about this ad. An alert
   * announces *new* results, so its arrival is within hours of publication —
   * which is why this beats our own import timestamp.
   */
  alertedAt?: Date | null;
  /** When the ad first entered the system by any route. */
  firstSeenAt: Date | null;
  importedAt: Date;
}

export interface AgeResult {
  source: AgeSource;
  /** Null only when nothing at all is known. */
  ageDays: number | null;
  /** The date the age was computed from. */
  at: Date | null;
  /** German, for the badge. */
  label: string;
  /**
   * True when the age is a lower bound rather than a fact — we know the ad is
   * *at least* this old, but it may be older. Never hide these on a maximum-age
   * filter without saying so.
   */
  approximate: boolean;
}

export function listingAge(input: AgeInput, now: Date = new Date()): AgeResult {
  const days = (d: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
  const human = (n: number) => (n === 0 ? 'heute' : n === 1 ? 'gestern' : `vor ${n} Tagen`);

  if (input.postedAt) {
    const n = days(input.postedAt);
    return {
      source: 'PORTAL',
      ageDays: n,
      at: input.postedAt,
      label: `Inseriert ${human(n)}`,
      approximate: false,
    };
  }

  if (input.alertedAt) {
    const n = days(input.alertedAt);
    return {
      source: 'ALERT',
      ageDays: n,
      at: input.alertedAt,
      label: `Neu gemeldet ${human(n)}`,
      approximate: false,
    };
  }

  const seen = input.firstSeenAt ?? input.importedAt;
  const n = days(seen);
  return {
    source: 'FIRST_SEEN',
    ageDays: n,
    at: seen,
    // Deliberately different wording: this is when *we* saw it, not when it
    // went up, and the badge must not pretend otherwise.
    label: `Seit ${human(n)} bekannt — Portal nennt kein Datum`,
    approximate: true,
  };
}

export interface AgeFilterSettings {
  /** Hide ads older than this. 0 disables the filter. */
  maxAgeDays: number;
  /**
   * What to do with ads whose age we only know approximately (no portal date).
   *
   * Default keeps them: on portals that never print a date — which includes
   * every ad that arrives by email — filtering strictly would empty the list
   * and look like "there is nothing", when really it means "we cannot tell".
   */
  hideApproximate: boolean;
}

export const DEFAULT_AGE_FILTER: AgeFilterSettings = {
  // Off by default: switching a filter on for someone silently is how a
  // working list turns into a mysteriously empty one.
  maxAgeDays: 0,
  hideApproximate: false,
};

/** Should this ad survive the age filter? */
export function passesAgeFilter(
  age: AgeResult,
  settings: AgeFilterSettings = DEFAULT_AGE_FILTER,
): boolean {
  if (settings.maxAgeDays <= 0) return true;
  if (age.ageDays == null) return !settings.hideApproximate;
  if (age.approximate && !settings.hideApproximate) return true;
  return age.ageDays <= settings.maxAgeDays;
}

/**
 * Explains what a maximum-age filter is currently doing to a set of ads, so
 * an empty list can say *why* it is empty rather than implying the market is.
 */
export function describeAgeFilter(
  ages: AgeResult[],
  settings: AgeFilterSettings = DEFAULT_AGE_FILTER,
): string | null {
  if (settings.maxAgeDays <= 0) return null;
  const hidden = ages.filter((a) => !passesAgeFilter(a, settings)).length;
  if (hidden === 0) return null;
  const approximate = ages.filter((a) => a.approximate).length;
  const base = `${hidden} Anzeige(n) ausgeblendet, weil älter als ${settings.maxAgeDays} Tage.`;
  return approximate > 0 && !settings.hideApproximate
    ? `${base} ${approximate} weitere ohne Portal-Datum werden weiterhin gezeigt.`
    : base;
}
