/**
 * Two time questions that decide whether a listing is worth a message today:
 *
 *  1. Is the ad still alive? An expired ad wastes a colleague's time and makes
 *     the whole inbox untrustworthy.
 *  2. Do the dates work? A flat free from the 15th when the nurse lands on the
 *     1st is not automatically out — it just needs a costed bridge, and a great
 *     flat can be worth two weeks of temporary accommodation.
 *
 * Pure and deterministic so both can be tested without a database.
 */

export type Freshness = 'NEW' | 'FRESH' | 'AGEING' | 'STALE' | 'EXPIRED';

export interface FreshnessSettings {
  /** Anything younger than this is highlighted as brand new. */
  newWithinHours: number;
  /** Beyond this the ad is probably gone; it gets a visible warning. */
  staleAfterDays: number;
  /** Hide expired ads from the default view. */
  hideExpired: boolean;
}

export const DEFAULT_FRESHNESS: FreshnessSettings = {
  newWithinHours: 24,
  staleAfterDays: 14,
  hideExpired: true,
};

export interface FreshnessResult {
  state: Freshness;
  ageDays: number;
  label: string;
  /** Multiplier applied to the preference score: stale ads sink. */
  scoreFactor: number;
}

export function evaluateFreshness(
  input: { firstSeenAt: Date; lastSeenAt: Date | null; expired: boolean },
  settings: FreshnessSettings = DEFAULT_FRESHNESS,
  now: Date = new Date(),
): FreshnessResult {
  if (input.expired) {
    return { state: 'EXPIRED', ageDays: 0, label: 'Abgelaufen', scoreFactor: 0 };
  }

  // "Last seen" is when a source alert last confirmed the ad; fall back to the
  // moment we first imported it.
  const reference = input.lastSeenAt ?? input.firstSeenAt;
  const ageMs = now.getTime() - reference.getTime();
  const ageHours = ageMs / 3_600_000;
  const ageDays = Math.max(0, Math.floor(ageMs / 86_400_000));

  if (ageHours <= settings.newWithinHours) {
    return { state: 'NEW', ageDays, label: 'Neu', scoreFactor: 1 };
  }
  if (ageDays <= Math.max(2, Math.round(settings.staleAfterDays / 3))) {
    return { state: 'FRESH', ageDays, label: `vor ${ageDays} Tagen`, scoreFactor: 1 };
  }
  if (ageDays <= settings.staleAfterDays) {
    return { state: 'AGEING', ageDays, label: `vor ${ageDays} Tagen`, scoreFactor: 0.95 };
  }
  return {
    state: 'STALE',
    ageDays,
    label: `vor ${ageDays} Tagen — evtl. vergeben`,
    scoreFactor: 0.75,
  };
}

/* ------------------------------------------------------- move-in timing --- */

export type TimingVerdict =
  | 'READY_BEFORE_ARRIVAL'
  | 'READY_ON_TIME'
  | 'BRIDGE_NEEDED'
  | 'BRIDGE_TOO_LONG'
  | 'UNKNOWN';

export interface BridgingSettings {
  /** Nightly cost of temporary accommodation used for the estimate. */
  nightlyRateCents: number;
  /** Beyond this many nights a bridge stops being reasonable. */
  maxBridgeNights: number;
  /**
   * Being free a few days before arrival is ideal — keys in hand, no gap.
   * Beyond this the candidate pays rent for an empty flat, which is a mild
   * downside rather than a problem.
   */
  idealLeadDays: number;
}

export const DEFAULT_BRIDGING: BridgingSettings = {
  nightlyRateCents: 6500, // ~65 €/night for an Airbnb or Monteurzimmer
  maxBridgeNights: 30,
  idealLeadDays: 14,
};

export interface TimingResult {
  verdict: TimingVerdict;
  /** Positive = flat is free before arrival. Negative = arrival is first. */
  leadDays: number | null;
  bridgeNights: number;
  bridgeCostCents: number;
  /** Rent for the days the flat sits empty before the candidate arrives. */
  emptyRentDays: number;
  label: string;
  reasons: string[];
  scoreFactor: number;
}

/**
 * Compares when a flat is free with when the candidate actually lands.
 *
 * Deliberately never returns "incompatible": a strong flat with a two-week gap
 * is often the right choice, so the cost is quantified instead of hidden.
 */
export function evaluateMoveInTiming(
  availableFrom: Date | null,
  arrivalDate: Date | null,
  monthlyRentCents: number | null,
  settings: BridgingSettings = DEFAULT_BRIDGING,
): TimingResult {
  const empty: TimingResult = {
    verdict: 'UNKNOWN',
    leadDays: null,
    bridgeNights: 0,
    bridgeCostCents: 0,
    emptyRentDays: 0,
    label: 'Verfügbarkeit unbekannt',
    reasons: [],
    scoreFactor: 1,
  };

  if (!availableFrom || !arrivalDate) {
    if (!arrivalDate) return { ...empty, label: 'Kein Ankunftsdatum hinterlegt' };
    return empty;
  }

  const dayMs = 86_400_000;
  const lead = Math.round(
    (startOfDay(arrivalDate).getTime() - startOfDay(availableFrom).getTime()) / dayMs,
  );

  // Flat is free on or before arrival — no gap to bridge.
  if (lead >= 0) {
    const emptyRentDays = Math.max(0, lead);
    if (lead === 0) {
      return {
        verdict: 'READY_ON_TIME',
        leadDays: 0,
        bridgeNights: 0,
        bridgeCostCents: 0,
        emptyRentDays: 0,
        label: 'Frei genau zur Ankunft',
        reasons: ['+ Frei genau zum Ankunftstag'],
        scoreFactor: 1,
      };
    }
    if (lead <= settings.idealLeadDays) {
      return {
        verdict: 'READY_BEFORE_ARRIVAL',
        leadDays: lead,
        bridgeNights: 0,
        bridgeCostCents: 0,
        emptyRentDays,
        label: `Frei ${lead} Tage vor Ankunft`,
        reasons: [`+ Schon ${lead} Tage vor Ankunft frei — Schlüssel liegen bereit`],
        scoreFactor: 1,
      };
    }
    // Free much earlier: fine, but rent runs before anyone moves in.
    const wasted = monthlyRentCents ? Math.round((monthlyRentCents / 30) * lead) : 0;
    return {
      verdict: 'READY_BEFORE_ARRIVAL',
      leadDays: lead,
      bridgeNights: 0,
      bridgeCostCents: 0,
      emptyRentDays,
      label: `Frei ${lead} Tage vor Ankunft`,
      reasons: [
        wasted > 0
          ? `~ ${lead} Tage Leerstand vor Einzug (≈ ${(wasted / 100).toFixed(0)} € Miete)`
          : `~ ${lead} Tage Leerstand vor Einzug`,
      ],
      scoreFactor: 0.98,
    };
  }

  // Arrival first, flat later → bridge accommodation needed.
  const bridgeNights = Math.abs(lead);
  const bridgeCostCents = bridgeNights * settings.nightlyRateCents;
  const tooLong = bridgeNights > settings.maxBridgeNights;

  return {
    verdict: tooLong ? 'BRIDGE_TOO_LONG' : 'BRIDGE_NEEDED',
    leadDays: lead,
    bridgeNights,
    bridgeCostCents,
    emptyRentDays: 0,
    label: `${bridgeNights} Tage Zwischenlösung nötig`,
    reasons: [
      `! Erst ${bridgeNights} Tage nach Ankunft frei — Zwischenunterkunft ≈ ${(
        bridgeCostCents / 100
      ).toFixed(0)} €`,
      ...(tooLong ? [`! Über ${settings.maxBridgeNights} Tage Überbrückung — meist unwirtschaftlich`] : []),
    ],
    // A gap costs money, so it lowers the score — but never to zero, because a
    // strong flat can still be the right call.
    scoreFactor: tooLong ? 0.7 : Math.max(0.8, 1 - bridgeNights / 100),
  };
}

/** Total first-period cost: bridge nights plus the first month's rent. */
export function firstPeriodCostCents(timing: TimingResult, monthlyRentCents: number | null): number | null {
  if (monthlyRentCents == null) return null;
  return monthlyRentCents + timing.bridgeCostCents;
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
