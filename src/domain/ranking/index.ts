/**
 * Compatibility + preference ranking for a candidate/listing pair.
 *
 * Two clean stages:
 *  1. classify() → COMPATIBLE / NEAR_MATCH / INCOMPATIBLE / INSUFFICIENT_DATA
 *     using hard rules. Unknown values never make something INCOMPATIBLE on
 *     their own; they push to NEAR_MATCH or INSUFFICIENT_DATA.
 *  2. score() → 0–100 preference score with a structured breakdown, only
 *     applied to COMPATIBLE and NEAR_MATCH listings.
 *
 * Weights come from a config object so the ranking is easy to tune from tests
 * or the admin surface without editing this file.
 */

import type { Furnishing, PropertyType, TriState } from '../parser';

export interface RankingProfile {
  workplaceLat: number | null;
  workplaceLon: number | null;
  maxWarmmieteCents: number;
  maxCommuteMinutes: number | null;
  radiusKm: number | null;
  adults: number;
  children: number;
  minRooms: number;
  preferredRooms: number;
  furnished: 'REQUIRED' | 'PREFERRED' | 'EITHER';
  wbsStatus: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
  temporaryMode: boolean;
  /** Cost we assume when only Kaltmiete is known; used only for near-match sorting. */
  budgetFuzzCents?: number;
}

export interface RankingListing {
  propertyType: PropertyType;
  furnishing: Furnishing;
  fittedKitchen: TriState;
  effectiveMonthlyCents: number | null;
  monthlyTotalComplete: boolean;
  kaltMieteCents: number | null;
  rooms: number | null;
  wbsRequired: TriState;
  exchangeRequired: TriState;
  petsAllowed: TriState;
  fixedTerm: TriState;
  distanceKm: number | null;
  commuteMinutes: number | null;
}

export type Compatibility = 'COMPATIBLE' | 'NEAR_MATCH' | 'INCOMPATIBLE' | 'INSUFFICIENT_DATA';

export interface ScoreBreakdown {
  furnishing: number;
  rooms: number;
  budget: number;
  commute: number;
  completeness: number;
  total: number;
}

export interface RankingResult {
  compatibility: Compatibility;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  blockers: string[];
  rankVersion: string;
}

export interface RankingWeights {
  furnishing: number;
  rooms: number;
  budget: number;
  commute: number;
  completeness: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  furnishing: 35,
  rooms: 25,
  budget: 20,
  commute: 15,
  completeness: 5,
};

export const RANK_VERSION = 'rank-2026-08-04';

const APARTMENT_TYPES = new Set<PropertyType>(['APARTMENT']);
const HARD_INCOMPATIBLE_TYPES = new Set<PropertyType>([
  'WG_ROOM',
  'HOUSE',
  'FOR_SALE',
  'EXCHANGE',
  'COMMERCIAL',
  'PARKING',
]);

// ---------------------------------------------------------- household → rooms

/**
 * Suggested minimum and preferred rooms, mirroring the table in the product
 * brief. These are defaults; the user can override before searching.
 *
 *   1 adult              → 1 / 1-2
 *   1 adult + 1 child    → 2 / 3
 *   couple, no children  → 2 / 2
 *   couple + 1 child     → 3 / 3
 *   couple + 2 children  → 3 / 4
 *   couple + 3 children  → 4 / 5
 */
export function suggestedMinRooms(adults: number, children: number): number {
  if (adults <= 1 && children === 0) return 1;
  if (adults === 1 && children === 1) return 2;
  if (adults >= 2 && children === 0) return 2;
  if (adults >= 2 && children === 1) return 3;
  if (adults >= 2 && children === 2) return 3;
  if (adults >= 2 && children === 3) return 4;
  // General fallback: cover every non-kitchen person, minus one shared room.
  return Math.max(2, adults + children - 1);
}

export function suggestedPreferredRooms(adults: number, children: number): number {
  if (adults <= 1 && children === 0) return 2;
  if (adults === 1 && children === 1) return 3;
  if (adults >= 2 && children === 0) return 2;
  if (adults >= 2 && children === 1) return 3;
  if (adults >= 2 && children === 2) return 4;
  if (adults >= 2 && children === 3) return 5;
  return Math.max(3, adults + children);
}

// -------------------------------------------------------------- classify

export function classify(listing: RankingListing, profile: RankingProfile): {
  compatibility: Compatibility;
  blockers: string[];
  softFlags: string[];
} {
  const blockers: string[] = [];
  const softFlags: string[] = [];

  // 1. Property type -- excluded types are hard failures.
  if (listing.propertyType === 'TEMPORARY' && !profile.temporaryMode) {
    blockers.push('Temporäres Wohnen (nur im Notfallmodus zulassen)');
  } else if (HARD_INCOMPATIBLE_TYPES.has(listing.propertyType)) {
    blockers.push(`Ungeeigneter Objekttyp: ${listing.propertyType}`);
  } else if (listing.propertyType === 'UNKNOWN') {
    softFlags.push('Objekttyp unbekannt');
  } else if (!APARTMENT_TYPES.has(listing.propertyType) && listing.propertyType !== 'TEMPORARY') {
    softFlags.push(`Objekttyp ${listing.propertyType} — bitte prüfen`);
  }

  // 2. WBS
  if (listing.wbsRequired === 'YES' && profile.wbsStatus === 'NOT_AVAILABLE') {
    blockers.push('WBS erforderlich, Kandidat ohne WBS');
  } else if (listing.wbsRequired === 'YES' && profile.wbsStatus === 'UNKNOWN') {
    softFlags.push('WBS erforderlich, WBS-Status des Kandidaten unbekannt');
  }

  // 3. Explicit exchange requirement
  if (listing.exchangeRequired === 'YES') {
    blockers.push('Tauschwohnung — nicht möglich');
  }

  // 4. Furnished REQUIRED
  if (profile.furnished === 'REQUIRED') {
    if (listing.furnishing === 'UNFURNISHED' || listing.furnishing === 'FURNITURE_TAKEOVER') {
      blockers.push('Möbliert erforderlich — Objekt nicht möbliert');
    } else if (listing.furnishing === 'UNKNOWN') {
      softFlags.push('Möbliert erforderlich, Möblierung des Objekts unbekannt');
    }
  }

  // 5. Rooms
  if (listing.rooms != null) {
    if (listing.rooms < profile.minRooms) {
      blockers.push(`Zu wenige Zimmer (${listing.rooms} < ${profile.minRooms})`);
    }
  } else {
    softFlags.push('Zimmeranzahl unbekannt');
  }

  // 6. Budget. Uses effectiveMonthlyCents when we trust it, otherwise pushes
  //    to soft/near-match — an unknown Warmmiete never fails hard here.
  const cap = profile.maxWarmmieteCents;
  if (listing.effectiveMonthlyCents != null && listing.monthlyTotalComplete) {
    if (listing.effectiveMonthlyCents > cap * 1.15) {
      blockers.push('Deutlich über Budget');
    } else if (listing.effectiveMonthlyCents > cap) {
      softFlags.push('Leicht über Budget');
    }
  } else if (listing.kaltMieteCents != null) {
    // Only Kaltmiete known → conservative check on Kaltmiete only.
    if (listing.kaltMieteCents > cap) {
      softFlags.push('Kaltmiete allein liegt schon über Budget');
    } else {
      softFlags.push('Gesamtkosten unbekannt — Warmmiete muss geprüft werden');
    }
  } else {
    softFlags.push('Mietkosten unbekannt');
  }

  // 7. Commute / radius (soft; unknown distance never blocks)
  if (listing.commuteMinutes != null && profile.maxCommuteMinutes != null) {
    if (listing.commuteMinutes > profile.maxCommuteMinutes * 1.5) {
      blockers.push('Anfahrt deutlich zu lang');
    } else if (listing.commuteMinutes > profile.maxCommuteMinutes) {
      softFlags.push('Anfahrt über Zielwert');
    }
  } else if (listing.distanceKm != null && profile.radiusKm != null) {
    if (listing.distanceKm > profile.radiusKm * 1.5) {
      blockers.push('Entfernung deutlich zu groß');
    } else if (listing.distanceKm > profile.radiusKm) {
      softFlags.push('Entfernung über Zielwert');
    }
  } else if (profile.workplaceLat != null && profile.workplaceLon != null && listing.distanceKm == null) {
    softFlags.push('Entfernung unbekannt');
  }

  // Insufficient-data escalation: type unknown + no rooms + no cost → we cannot
  // even say near-match. That's an INSUFFICIENT_DATA listing.
  const hasAnySignal =
    listing.rooms != null || listing.effectiveMonthlyCents != null || listing.propertyType !== 'UNKNOWN';

  if (blockers.length > 0) return { compatibility: 'INCOMPATIBLE', blockers, softFlags };
  if (!hasAnySignal) return { compatibility: 'INSUFFICIENT_DATA', blockers, softFlags };
  if (softFlags.length > 0) return { compatibility: 'NEAR_MATCH', blockers, softFlags };
  return { compatibility: 'COMPATIBLE', blockers, softFlags };
}

// ------------------------------------------------------------------- score

function furnishingSubscore(l: RankingListing, p: RankingProfile): { pct: number; reason: string } {
  const f = l.furnishing;
  if (p.furnished === 'EITHER') {
    return { pct: 100, reason: 'Möblierung egal' };
  }
  switch (f) {
    case 'FULLY_FURNISHED':
      return { pct: 100, reason: 'Vollmöbliert' };
    case 'FURNISHED':
      return { pct: 90, reason: 'Möbliert' };
    case 'PARTIALLY_FURNISHED':
      return { pct: 60, reason: 'Teilmöbliert' };
    case 'FURNITURE_TAKEOVER':
      return { pct: 30, reason: 'Möbelübernahme (Ablöse fällig)' };
    case 'UNFURNISHED':
      // If preferred but not required, unfurnished still scores something.
      return p.furnished === 'PREFERRED'
        ? { pct: 20, reason: 'Unmöbliert (bevorzugt möbliert)' }
        : { pct: 100, reason: 'Möblierung egal' };
    case 'UNKNOWN':
    default:
      return { pct: 50, reason: 'Möblierung unbekannt' };
  }
}

function roomsSubscore(l: RankingListing, p: RankingProfile): { pct: number; reason: string } {
  if (l.rooms == null) return { pct: 50, reason: 'Zimmeranzahl unbekannt' };
  if (l.rooms < p.minRooms) return { pct: 0, reason: 'Weniger Zimmer als Minimum' };
  if (l.rooms >= p.preferredRooms) return { pct: 100, reason: `${l.rooms} Zimmer ≥ Wunschgröße` };
  const range = Math.max(0.1, p.preferredRooms - p.minRooms);
  const dist = p.preferredRooms - l.rooms;
  const pct = Math.max(0, Math.round(100 - (dist / range) * 40));
  return { pct, reason: `${l.rooms} Zimmer (Ziel ${p.preferredRooms})` };
}

function budgetSubscore(l: RankingListing, p: RankingProfile): { pct: number; reason: string } {
  if (l.effectiveMonthlyCents == null) return { pct: 40, reason: 'Kosten unbekannt' };
  const cap = p.maxWarmmieteCents;
  const eff = l.effectiveMonthlyCents;
  if (eff > cap) {
    const overCents = eff - cap;
    const overFraction = overCents / cap;
    const pct = Math.max(0, Math.round(50 - overFraction * 200));
    return { pct, reason: 'Über Budget' };
  }
  const underCents = cap - eff;
  // Reward being under budget up to 25 % below cap.
  const underFraction = Math.min(underCents / cap, 0.25) / 0.25;
  const pct = Math.round(75 + underFraction * 25);
  if (!l.monthlyTotalComplete) {
    return { pct: Math.max(50, pct - 20), reason: 'Innerhalb Budget, aber Kosten unvollständig' };
  }
  return {
    pct,
    reason: underCents > 0 ? `${Math.round(underCents / 100)} € unter Budget` : 'Am Budgetlimit',
  };
}

function commuteSubscore(l: RankingListing, p: RankingProfile): { pct: number; reason: string } {
  if (p.maxCommuteMinutes == null && p.radiusKm == null) {
    return { pct: 80, reason: 'Kein Anfahrtsziel gesetzt' };
  }
  if (l.commuteMinutes != null && p.maxCommuteMinutes != null) {
    if (l.commuteMinutes <= p.maxCommuteMinutes * 0.6) return { pct: 100, reason: 'Kurze Anfahrt' };
    if (l.commuteMinutes <= p.maxCommuteMinutes) {
      const pct = 100 - Math.round((l.commuteMinutes / p.maxCommuteMinutes) * 20);
      return { pct, reason: `${l.commuteMinutes} min Anfahrt` };
    }
    const over = l.commuteMinutes - p.maxCommuteMinutes;
    const pct = Math.max(0, 60 - Math.round((over / p.maxCommuteMinutes) * 60));
    return { pct, reason: `${l.commuteMinutes} min — über Zielwert` };
  }
  if (l.distanceKm != null && p.radiusKm != null) {
    if (l.distanceKm <= p.radiusKm * 0.5) return { pct: 100, reason: 'Nahe am Arbeitsort' };
    if (l.distanceKm <= p.radiusKm) {
      const pct = 100 - Math.round((l.distanceKm / p.radiusKm) * 20);
      return { pct, reason: `${l.distanceKm.toFixed(1)} km` };
    }
    const over = l.distanceKm - p.radiusKm;
    const pct = Math.max(0, 60 - Math.round((over / p.radiusKm) * 60));
    return { pct, reason: `${l.distanceKm.toFixed(1)} km — über Zielradius` };
  }
  return { pct: 40, reason: 'Entfernung unbekannt' };
}

function completenessSubscore(l: RankingListing): { pct: number; reason: string } {
  const knownCount =
    (l.propertyType !== 'UNKNOWN' ? 1 : 0) +
    (l.furnishing !== 'UNKNOWN' ? 1 : 0) +
    (l.rooms != null ? 1 : 0) +
    (l.effectiveMonthlyCents != null ? 1 : 0) +
    (l.monthlyTotalComplete ? 1 : 0);
  const pct = Math.round((knownCount / 5) * 100);
  return { pct, reason: knownCount === 5 ? 'Vollständige Daten' : `${knownCount}/5 Kerndaten bekannt` };
}

export function score(
  listing: RankingListing,
  profile: RankingProfile,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): { score: number; breakdown: ScoreBreakdown; reasons: string[] } {
  const furn = furnishingSubscore(listing, profile);
  const rooms = roomsSubscore(listing, profile);
  const bud = budgetSubscore(listing, profile);
  const comm = commuteSubscore(listing, profile);
  const comp = completenessSubscore(listing);

  const weightedTotal =
    (furn.pct * weights.furnishing +
      rooms.pct * weights.rooms +
      bud.pct * weights.budget +
      comm.pct * weights.commute +
      comp.pct * weights.completeness) /
    (weights.furnishing + weights.rooms + weights.budget + weights.commute + weights.completeness);

  const breakdown: ScoreBreakdown = {
    furnishing: furn.pct,
    rooms: rooms.pct,
    budget: bud.pct,
    commute: comm.pct,
    completeness: comp.pct,
    total: Math.round(weightedTotal),
  };

  const reasons: string[] = [];
  const pushReason = (prefix: string, r: { pct: number; reason: string }) => {
    if (r.pct >= 80) reasons.push(`+ ${r.reason}`);
    else if (r.pct >= 50) reasons.push(`~ ${r.reason}`);
    else reasons.push(`− ${r.reason}`);
  };
  pushReason('furn', furn);
  pushReason('rooms', rooms);
  pushReason('budget', bud);
  pushReason('commute', comm);
  if (comp.pct < 100) reasons.push(`! ${comp.reason}`);

  return { score: breakdown.total, breakdown, reasons };
}

/** Convenience wrapper: classify + score in one go. */
export function rank(
  listing: RankingListing,
  profile: RankingProfile,
  weights: RankingWeights = DEFAULT_WEIGHTS,
): RankingResult {
  const cls = classify(listing, profile);
  if (cls.compatibility === 'INCOMPATIBLE') {
    return {
      compatibility: cls.compatibility,
      score: 0,
      breakdown: { furnishing: 0, rooms: 0, budget: 0, commute: 0, completeness: 0, total: 0 },
      reasons: cls.blockers.map((b) => `x ${b}`),
      blockers: cls.blockers,
      rankVersion: RANK_VERSION,
    };
  }
  if (cls.compatibility === 'INSUFFICIENT_DATA') {
    return {
      compatibility: cls.compatibility,
      score: 0,
      breakdown: { furnishing: 0, rooms: 0, budget: 0, commute: 0, completeness: 0, total: 0 },
      reasons: ['! Zu wenige Daten für Bewertung'],
      blockers: [],
      rankVersion: RANK_VERSION,
    };
  }
  const s = score(listing, profile, weights);
  return {
    compatibility: cls.compatibility,
    score: s.score,
    breakdown: s.breakdown,
    reasons: [...s.reasons, ...cls.softFlags.map((f) => `! ${f}`)],
    blockers: [],
    rankVersion: RANK_VERSION,
  };
}
