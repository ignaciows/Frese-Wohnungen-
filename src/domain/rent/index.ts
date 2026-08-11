/**
 * What a flat actually costs per month — and whether the figure can be a
 * monthly rent at all.
 *
 * Two things kept going wrong, and both were visible in the live pool.
 *
 * **Most adverts only print the Kaltmiete.** 103 of 160 live listings, so this
 * is the normal case rather than the exception. The budget check compared that
 * bare Kaltmiete against a Warmmiete cap, which understates the real cost by
 * whatever the Nebenkosten happen to be: a 900 € Kaltmiete flat passed a
 * 1000 € warm budget and then cost 1150 €. Every such advert was being judged
 * generously, in the one direction that wastes a candidate's time.
 *
 * **Some figures are not monthly rents.** The cheapest entries in the pool were
 * 18 €, 20 € and 80 € — per-night prices from short-stay adverts around a trade
 * fair, read as if they were monthly. A rent of 40 € a month does not exist,
 * and an advert claiming one crowds out a real flat at the top of a
 * price-sorted list.
 */

/**
 * Additional monthly cost per square metre, in cents.
 *
 * 2.50 €/m² covers Betriebskosten plus heating at the German average
 * (Betriebskostenspiegel puts the cold operating costs near 1.80–2.20 €/m² and
 * heating near 1.00–1.40 €/m²; the middle of that is a fair, slightly
 * conservative estimate). Deliberately erring high: an estimate that flatters
 * a flat sends somebody to a viewing they cannot afford, while one that is a
 * little pessimistic only ever costs a second look.
 */
const NEBENKOSTEN_PER_SQM_CENTS = 250;

/** Used when the size is unknown. German Nebenkosten run about a quarter of the cold rent. */
const NEBENKOSTEN_FRACTION = 0.25;

/**
 * The band a real monthly rent falls in, per flat and per square metre.
 *
 * The floor is what rules out per-night pricing: the cheapest genuine
 * long-term room in Germany is well over 150 € a month, while a nightly rate
 * for the same room is 20–80 €. The ceiling catches a purchase price or a
 * misplaced decimal point.
 */
export const MIN_PLAUSIBLE_MONTHLY_CENTS = 15_000; // 150 €
export const MAX_PLAUSIBLE_MONTHLY_CENTS = 800_000; // 8 000 €
/** Below this per square metre nothing is let long-term, anywhere in Germany. */
const MIN_PLAUSIBLE_PER_SQM_CENTS = 300; // 3 €/m²
/** Above it, the figure is a purchase price, a typo, or not a rent. */
const MAX_PLAUSIBLE_PER_SQM_CENTS = 8_000; // 80 €/m²

export type RentBasisKind =
  /** The advert stated the total. */
  | 'ACTUAL'
  /** Cold rent plus an estimate of what is missing. */
  | 'ESTIMATED'
  /** Nothing usable. */
  | 'UNKNOWN';

export interface RentAssessment {
  /** The figure to judge a budget against. Null when nothing is known. */
  basisCents: number | null;
  basisKind: RentBasisKind;
  /** German, for the row and the detail pane. Null when there is nothing to add. */
  note: string | null;
  /** False when the stated figure cannot be a monthly rent. */
  plausible: boolean;
  /** Why not, for the discovery log. Empty when plausible. */
  implausibleReason: string;
}

export interface RentInput {
  kaltMieteCents?: number | null;
  warmMieteCents?: number | null;
  nebenkostenCents?: number | null;
  heizkostenCents?: number | null;
  /** Used to estimate what a missing Nebenkosten line would be. */
  livingSpaceSqm?: number | null;
}

/**
 * What the missing part of the rent is probably worth.
 *
 * Per square metre when the size is known, because that is how German
 * operating costs are actually billed; a flat fraction of the cold rent
 * otherwise, which is coarser but never wildly wrong.
 */
export function estimateNebenkostenCents(
  kaltMieteCents: number,
  livingSpaceSqm?: number | null,
): number {
  if (livingSpaceSqm != null && livingSpaceSqm > 0) {
    return Math.round(livingSpaceSqm * NEBENKOSTEN_PER_SQM_CENTS);
  }
  return Math.round(kaltMieteCents * NEBENKOSTEN_FRACTION);
}

export function assessRent(input: RentInput): RentAssessment {
  const warm = positive(input.warmMieteCents);
  const kalt = positive(input.kaltMieteCents);
  const extras = (positive(input.nebenkostenCents) ?? 0) + (positive(input.heizkostenCents) ?? 0);
  const sqm = input.livingSpaceSqm != null && input.livingSpaceSqm > 0 ? input.livingSpaceSqm : null;

  let basisCents: number | null = null;
  let basisKind: RentBasisKind = 'UNKNOWN';
  let note: string | null = null;

  if (warm != null) {
    basisCents = warm;
    basisKind = 'ACTUAL';
  } else if (kalt != null && extras > 0) {
    basisCents = kalt + extras;
    // Only a true total once both lines are present; one of them still leaves
    // a gap, so it stays an estimate rather than a promise.
    const complete = input.nebenkostenCents != null && input.heizkostenCents != null;
    basisKind = complete ? 'ACTUAL' : 'ESTIMATED';
    if (!complete) note = 'Heiz- oder Nebenkosten fehlen — Gesamtkosten geschätzt';
  } else if (kalt != null) {
    const estimated = estimateNebenkostenCents(kalt, sqm);
    basisCents = kalt + estimated;
    basisKind = 'ESTIMATED';
    note = sqm
      ? `Nur Kaltmiete angegeben — mit ${(NEBENKOSTEN_PER_SQM_CENTS / 100).toFixed(2)} €/m² Nebenkosten geschätzt`
      : 'Nur Kaltmiete angegeben — Nebenkosten mit 25 % geschätzt';
  }

  const stated = warm ?? kalt;
  const bad = implausibleReason(stated, sqm);

  return {
    basisCents,
    basisKind,
    note,
    plausible: bad === '',
    implausibleReason: bad,
  };
}

/** Empty string when the figure could be a real monthly rent. */
function implausibleReason(statedCents: number | null | undefined, sqm: number | null): string {
  if (statedCents == null) return '';

  if (statedCents < MIN_PLAUSIBLE_MONTHLY_CENTS) {
    return `${euro(statedCents)} kann keine Monatsmiete sein — vermutlich ein Preis pro Nacht`;
  }
  if (statedCents > MAX_PLAUSIBLE_MONTHLY_CENTS) {
    return `${euro(statedCents)} ist für eine Monatsmiete zu hoch — vermutlich ein Kaufpreis`;
  }

  if (sqm != null) {
    const perSqm = statedCents / sqm;
    if (perSqm < MIN_PLAUSIBLE_PER_SQM_CENTS) {
      return `${euro(statedCents)} für ${sqm} m² ist unrealistisch günstig — Angabe prüfen`;
    }
    if (perSqm > MAX_PLAUSIBLE_PER_SQM_CENTS) {
      return `${euro(statedCents)} für ${sqm} m² ist unrealistisch teuer — vermutlich kein Monatspreis`;
    }
  }

  return '';
}

function positive(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function euro(cents: number): string {
  return `${Math.round(cents / 100)} €`;
}
