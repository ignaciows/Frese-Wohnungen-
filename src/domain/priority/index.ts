/**
 * Candidate priority — "who do we work on next, and how many Anfragen does
 * this person actually need?"
 *
 * This is a different question from listing ranking. Ranking sorts apartments
 * for one candidate. Priority sorts candidates against each other, and derives
 * a realistic contact target from how hard their destination market is.
 *
 * Design rules, consistent with the rest of the product:
 *  - deterministic and explainable; every number comes with a reason string,
 *  - honest about evidence: a seeded estimate is clearly separated from what we
 *    actually measured, and the blend between them is driven by sample size,
 *  - no data invented at read time; observed rates come from our own contacts.
 */

export type PriorityTier = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export interface RegionObservation {
  /** Contacts we have sent for apartments in this region. */
  contactsSent: number;
  /** Of those, how many got a positive reply. */
  positiveResponses: number;
  /** Suitable listings imported in this region. */
  listingsImported: number;
  /** Search runs executed for this region. */
  searchRuns: number;
}

export interface RegionSeed {
  /** Starting estimate 0..100 used until our own data outweighs it. */
  seededDifficulty: number;
  seedNote?: string | null;
}

export interface MarketDifficulty {
  /** 0 = easy market, 100 = brutal. */
  difficulty: number;
  /** 0..1 — how much of `difficulty` comes from our own measurements. */
  confidence: number;
  /** Smoothed probability that one Anfrage gets a positive reply. */
  expectedPositiveRate: number;
  /** Suitable listings we typically find per search run, if measured. */
  listingsPerRun: number | null;
  reasons: string[];
}

/* -------------------------------------------------------------- constants */

export const PRIORITY_CONFIG = {
  /**
   * Prior belief before we have local data: roughly 1 positive reply per 8
   * Anfragen. Deliberately conservative — it is a starting point that our own
   * numbers override, not a claim about the German market.
   */
  priorPositiveRate: 0.125,
  /**
   * Strength of that prior, in "virtual contacts". After ~15 real contacts in a
   * region our own rate carries more weight than the prior.
   */
  priorStrength: 15,
  /** Sample size at which observed difficulty fully replaces the seed. */
  confidenceHalfLife: 15,
  /** How many positive leads we want in flight before a candidate is safe. */
  desiredPositives: 3,
  /** Guardrails so a bad rate never produces an absurd workload. */
  minTargetContacts: 5,
  maxTargetContacts: 60,
  /** A region where we find this many suitable listings per run counts as easy. */
  healthyListingsPerRun: 12,
  weights: {
    deadline: 0.35,
    waiting: 0.2,
    market: 0.25,
    gap: 0.2,
  },
  tiers: { critical: 75, high: 55, normal: 35 },
} as const;

/* --------------------------------------------------------- market difficulty */

/**
 * Beta-smoothed success rate. With few observations it stays near the prior;
 * with many it converges on what we actually measured. This is what lets the
 * model "extrapolate once there is enough data" without swinging wildly on the
 * first two Anfragen.
 */
export function smoothedPositiveRate(
  positives: number,
  contacts: number,
  priorRate = PRIORITY_CONFIG.priorPositiveRate,
  strength = PRIORITY_CONFIG.priorStrength,
): number {
  const p = Math.max(0, positives);
  const n = Math.max(0, contacts);
  return (p + priorRate * strength) / (n + strength);
}

export function computeMarketDifficulty(
  seed: RegionSeed,
  observed: RegionObservation,
): MarketDifficulty {
  const reasons: string[] = [];
  const seeded = clamp(seed.seededDifficulty, 0, 100);

  const rate = smoothedPositiveRate(observed.positiveResponses, observed.contactsSent);

  // How much do our own measurements count? Grows with the number of contacts.
  const confidence = observed.contactsSent / (observed.contactsSent + PRIORITY_CONFIG.confidenceHalfLife);

  // Two independent ways a market can be hard:
  //  1. nobody answers (competition),
  //  2. there is nothing to answer to (scarcity — the "middle of nowhere" case).
  const responseDifficulty = clamp((1 - rate / 0.35) * 100, 0, 100);

  let listingsPerRun: number | null = null;
  let scarcityDifficulty = seeded;
  if (observed.searchRuns > 0) {
    listingsPerRun = observed.listingsImported / observed.searchRuns;
    scarcityDifficulty = clamp(
      (1 - listingsPerRun / PRIORITY_CONFIG.healthyListingsPerRun) * 100,
      0,
      100,
    );
  }

  // The harder of the two drives the workload — both mean "send more Anfragen".
  const observedDifficulty = Math.max(responseDifficulty, scarcityDifficulty);
  const difficulty = clamp(confidence * observedDifficulty + (1 - confidence) * seeded, 0, 100);

  if (observed.contactsSent === 0) {
    reasons.push(
      `Startschätzung ${Math.round(seeded)}/100${seed.seedNote ? ` (${seed.seedNote})` : ''} — noch keine eigenen Daten`,
    );
  } else {
    reasons.push(
      `${observed.positiveResponses} positive Antworten aus ${observed.contactsSent} Anfragen (≈ ${(rate * 100).toFixed(0)} % Erfolgsquote)`,
    );
    if (confidence < 0.5) {
      reasons.push(`noch wenig Daten — Schätzung zu ${Math.round((1 - confidence) * 100)} % aus Startwert`);
    }
    if (listingsPerRun != null && scarcityDifficulty > responseDifficulty) {
      reasons.push(`wenig Angebot: nur ${listingsPerRun.toFixed(1)} passende Anzeigen pro Suchlauf`);
    }
  }

  return { difficulty, confidence, expectedPositiveRate: rate, listingsPerRun, reasons };
}

/**
 * How many Anfragen this region realistically needs to produce
 * `desiredPositives` interested landlords.
 */
export function targetAnfragen(
  expectedPositiveRate: number,
  desiredPositives = PRIORITY_CONFIG.desiredPositives,
): number {
  const raw = Math.ceil(desiredPositives / Math.max(expectedPositiveRate, 0.01));
  return clamp(raw, PRIORITY_CONFIG.minTargetContacts, PRIORITY_CONFIG.maxTargetContacts);
}

/* ------------------------------------------------------- candidate priority */

export interface PriorityInput {
  /** When the contract was signed in the existing Frese system — the search clock starts here. */
  searchStartedAt: Date;
  /** Desired move-in date, if known. */
  moveInDate: Date | null;
  contactsSent: number;
  positiveResponses: number;
  /** True once a flat is secured, which retires the case from the queue. */
  settled: boolean;
  market: MarketDifficulty;
  now?: Date;
}

export interface PriorityResult {
  score: number;
  tier: PriorityTier;
  targetContacts: number;
  contactsSent: number;
  remainingContacts: number;
  daysWaiting: number;
  daysUntilMoveIn: number | null;
  reasons: string[];
  components: { deadline: number; waiting: number; market: number; gap: number };
}

export function computeCandidatePriority(input: PriorityInput): PriorityResult {
  const now = input.now ?? new Date();
  const reasons: string[] = [];

  const daysWaiting = Math.max(0, daysBetween(input.searchStartedAt, now));
  const daysUntilMoveIn = input.moveInDate ? daysBetween(now, input.moveInDate) : null;

  const targetContacts = targetAnfragen(input.market.expectedPositiveRate);
  const remainingContacts = Math.max(0, targetContacts - input.contactsSent);

  // 1. Deadline pressure — the move-in date dominates when it is known.
  let deadline: number;
  if (daysUntilMoveIn == null) {
    // No date: fall back to elapsed time, which is a weaker signal.
    deadline = clamp((daysWaiting / 45) * 70, 0, 70);
    reasons.push('Kein Einzugsdatum hinterlegt — Dringlichkeit nur aus Wartezeit');
  } else if (daysUntilMoveIn <= 0) {
    deadline = 100;
    reasons.push(`Einzugstermin ist überschritten (${Math.abs(daysUntilMoveIn)} Tage)`);
  } else {
    deadline = clamp(((90 - daysUntilMoveIn) / 76) * 100, 0, 100);
    if (daysUntilMoveIn <= 21) reasons.push(`Nur noch ${daysUntilMoveIn} Tage bis zum Einzug`);
    else if (daysUntilMoveIn <= 45) reasons.push(`${daysUntilMoveIn} Tage bis zum Einzug`);
  }

  // 2. How long this candidate has been waiting since the contract was signed.
  const waiting = clamp((daysWaiting / 30) * 100, 0, 100);
  if (daysWaiting >= 21) reasons.push(`Seit ${daysWaiting} Tagen in der Suche`);

  // 3. Market difficulty of the destination.
  const market = input.market.difficulty;
  if (market >= 70) reasons.push(`Schwieriger Markt (${Math.round(market)}/100) — mehr Anfragen nötig`);

  // 4. Workload gap: how far below the Anfrage target we are. A candidate that
  //    already has positive replies is much less at risk even if below target.
  const rawGap = targetContacts === 0 ? 0 : (remainingContacts / targetContacts) * 100;
  const positiveRelief = Math.min(input.positiveResponses, 3) / 3; // 0..1
  const gap = clamp(rawGap * (1 - 0.7 * positiveRelief), 0, 100);
  if (remainingContacts > 0 && input.positiveResponses === 0) {
    reasons.push(`${input.contactsSent} von ${targetContacts} Anfragen gesendet — ${remainingContacts} offen`);
  }
  if (input.positiveResponses > 0) {
    reasons.push(`${input.positiveResponses} positive Rückmeldung(en) — Risiko gesunken`);
  }

  const w = PRIORITY_CONFIG.weights;
  let score = deadline * w.deadline + waiting * w.waiting + market * w.market + gap * w.gap;

  if (input.settled) {
    score = 0;
    reasons.length = 0;
    reasons.push('Wohnung gesichert — nicht mehr in der Warteschlange');
  }

  score = clamp(score, 0, 100);

  return {
    score,
    tier: tierFor(score),
    targetContacts,
    contactsSent: input.contactsSent,
    remainingContacts,
    daysWaiting,
    daysUntilMoveIn,
    reasons,
    components: { deadline, waiting, market, gap },
  };
}

export function tierFor(score: number): PriorityTier {
  if (score >= PRIORITY_CONFIG.tiers.critical) return 'CRITICAL';
  if (score >= PRIORITY_CONFIG.tiers.high) return 'HIGH';
  if (score >= PRIORITY_CONFIG.tiers.normal) return 'NORMAL';
  return 'LOW';
}

/* ------------------------------------------------------------------ helpers */

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Region key used to aggregate market data. Postal prefixes group a town with
 * its surroundings, which is the level our search actually operates at.
 */
export function regionKeyFor(postalCode: string | null, city: string | null): string | null {
  if (postalCode && /^\d{5}$/.test(postalCode.trim())) return postalCode.trim().slice(0, 3);
  if (city && city.trim()) return `city:${city.trim().toLowerCase()}`;
  return null;
}
