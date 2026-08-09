/**
 * Flatmate (WG) matching between two candidate cases.
 *
 * Two nurses arriving in the same area at the same time can share a bigger,
 * cheaper flat — but only if both said they are open to it, and only after a
 * colleague has actually asked them. This module therefore produces
 * *suggestions with reasons*, never an arrangement.
 *
 * Everything here is deterministic and driven by admin-editable settings, so
 * the rules can be tuned without a deployment.
 */

export type NationalityRule = 'SAME_ONLY' | 'PREFER_SAME' | 'IGNORE';

export interface SharingSettings {
  enabled: boolean;
  /** How far apart the two move-in dates may be. */
  maxMoveInGapDays: number;
  /** Require the same postal prefix (same local market) rather than any distance. */
  requireSameRegion: boolean;
  nationalityRule: NationalityRule;
  /** Bonus weight when both share a language. */
  considerLanguages: boolean;
  /** Suggestions below this score are not shown. */
  minScore: number;
}

export const DEFAULT_SHARING_SETTINGS: SharingSettings = {
  enabled: true,
  maxMoveInGapDays: 21,
  requireSameRegion: true,
  // Defaults to the softer rule on purpose: same nationality is treated as a
  // helpful signal, not a gate. An admin can harden or disable it.
  nationalityRule: 'PREFER_SAME',
  considerLanguages: true,
  minScore: 55,
};

export interface SharingCandidate {
  id: string;
  reference: string;
  displayName: string;
  openToSharing: boolean;
  nationality: string | null;
  languages: string | null;
  moveInDate: Date | null;
  regionKey: string | null;
  workplaceCity: string | null;
  maxWarmmieteCents: number;
  adults: number;
  children: number;
  housingSecured: boolean;
}

export interface SharingSuggestion {
  aId: string;
  bId: string;
  score: number;
  reasons: string[];
  /** Combined budget if they share — the actual selling point. */
  combinedBudgetCents: number;
  suggestedMinRooms: number;
}

function norm(s: string | null): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[,;/]| und |\+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function daysApart(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

/**
 * Decides whether two candidates could plausibly share, and how strong the
 * match is. Returns null when a hard rule rules the pair out.
 */
export function evaluatePair(
  a: SharingCandidate,
  b: SharingCandidate,
  settings: SharingSettings,
): SharingSuggestion | null {
  if (!settings.enabled) return null;

  // --- hard gates -------------------------------------------------------
  if (a.id === b.id) return null;
  // Consent first: never pair someone who did not agree to the idea.
  if (!a.openToSharing || !b.openToSharing) return null;
  if (a.housingSecured || b.housingSecured) return null;
  // Families need their own flat; sharing is for single arrivals.
  if (a.children > 0 || b.children > 0) return null;
  if (a.adults > 1 || b.adults > 1) return null;

  if (settings.requireSameRegion) {
    if (!a.regionKey || !b.regionKey || a.regionKey !== b.regionKey) return null;
  }

  if (!a.moveInDate || !b.moveInDate) return null;
  const gap = daysApart(a.moveInDate, b.moveInDate);
  if (gap > settings.maxMoveInGapDays) return null;

  const sameNationality =
    !!a.nationality && !!b.nationality && a.nationality.trim().toLowerCase() === b.nationality.trim().toLowerCase();

  if (settings.nationalityRule === 'SAME_ONLY' && !sameNationality) return null;

  // --- score ------------------------------------------------------------
  const reasons: string[] = [];
  let score = 0;

  // Move-in proximity — the core signal (max 40).
  const timing = Math.max(0, 40 - (gap / settings.maxMoveInGapDays) * 40);
  score += timing;
  reasons.push(
    gap === 0
      ? 'Beide ziehen am selben Tag ein'
      : `Einzugstermine liegen ${gap} Tag(e) auseinander`,
  );

  // Same local market (max 25).
  if (a.regionKey && b.regionKey && a.regionKey === b.regionKey) {
    score += 25;
    reasons.push(
      `Gleiche Region${a.workplaceCity && a.workplaceCity === b.workplaceCity ? ` (${a.workplaceCity})` : ''}`,
    );
  }

  // Nationality (max 15) — only when the rule asks for it.
  if (settings.nationalityRule !== 'IGNORE' && sameNationality) {
    score += 15;
    reasons.push(`Gleiche Herkunft (${a.nationality})`);
  }

  // Shared language (max 10).
  if (settings.considerLanguages) {
    const shared = norm(a.languages).filter((l) => norm(b.languages).includes(l));
    if (shared.length > 0) {
      score += 10;
      reasons.push(`Gemeinsame Sprache: ${shared.join(', ')}`);
    }
  }

  // Similar budget (max 10) — very different budgets make a shared flat awkward.
  const ratio =
    Math.min(a.maxWarmmieteCents, b.maxWarmmieteCents) / Math.max(a.maxWarmmieteCents, b.maxWarmmieteCents);
  score += ratio * 10;
  if (ratio >= 0.8) reasons.push('Ähnliches Budget');

  const combinedBudgetCents = a.maxWarmmieteCents + b.maxWarmmieteCents;
  reasons.push(
    `Gemeinsames Budget ${(combinedBudgetCents / 100).toFixed(0)} € statt ${(a.maxWarmmieteCents / 100).toFixed(0)} € allein`,
  );

  score = Math.round(Math.min(100, score));
  if (score < settings.minScore) return null;

  // Two single adults sharing need at least two bedrooms plus a living room.
  const suggestedMinRooms = 3;

  // Stable ordering so a pair is always stored the same way round.
  const [aId, bId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  return { aId, bId, score, reasons, combinedBudgetCents, suggestedMinRooms };
}

/** All plausible pairings across the active candidate pool, best first. */
export function findSharingSuggestions(
  candidates: SharingCandidate[],
  settings: SharingSettings,
): SharingSuggestion[] {
  const out: SharingSuggestion[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const s = evaluatePair(candidates[i], candidates[j], settings);
      if (s) out.push(s);
    }
  }
  return out.sort((x, y) => y.score - x.score || x.aId.localeCompare(y.aId));
}
