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
  /** The postcode-based location check falls back on these without a geocoder. */
  workplacePostalCode?: string | null;
  workplaceCity?: string | null;
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
  /**
   * The day the person lands. The single most consequential date in the case,
   * and until now it was not part of the score at all: a perfect flat that is
   * free three weeks too late scored the same as one free on time.
   */
  moveInDate?: Date | null;
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
  /** Lets the missing Nebenkosten be estimated per square metre. */
  livingSpaceSqm?: number | null;
  /** Used to sanity-check location when no distance can be computed. */
  locationPostal?: string | null;
  locationCity?: string | null;
  /** When the advert says the flat can be moved into. */
  availableFrom?: Date | null;
  /**
   * True for the platforms that only let flats by the week or month —
   * Wunderflats, HousingAnywhere, Boardinghouses and the like.
   *
   * Their adverts look excellent on paper (furnished, central, complete data)
   * and are useless for somebody moving to Germany permanently: no move-in
   * date, a nightly-derived price, and a contract that ends. Judged by source
   * category rather than by wording, because the wording is deliberately
   * indistinguishable from a normal flat.
   */
  shortStayProvider?: boolean;
  /**
   * Why this advert cannot be rented at all, if it cannot.
   *
   * The same rules that stop rubbish entering the pool — a rent of 18 €, a
   * "flat" with twenty rooms, a Monteurzimmer by the week — applied to what is
   * *already* in it. Filtering at import only fixed the future: a live pool
   * still had "Luxuriös Unterkunft für Gamescom, 135 €" sitting at the top of
   * the list, scored and green, because it arrived before the rule existed.
   */
  disqualified?: string | null;
}

import { postalProximity, cityMismatch } from './postalDistance';
import { assessRent } from '../rent';

export type Compatibility = 'COMPATIBLE' | 'NEAR_MATCH' | 'INCOMPATIBLE' | 'INSUFFICIENT_DATA';

export interface ScoreBreakdown {
  /** Highest score this advert could reach given what is unknown about it. */
  cap: number;
  furnishing: number;
  rooms: number;
  budget: number;
  commute: number;
  completeness: number;
  /** Fit between the flat's free-from date and the arrival. */
  timing: number;
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
  /** How well the flat's free-from date fits the arrival. */
  timing: number;
}

/**
 * What actually decides whether a flat is worth writing to.
 *
 * The old weighting had furnishing at 35 % — more than price and distance put
 * together — and no timing at all. That is backwards for this job: the people
 * this tool serves arrive on a known date, work at a known clinic and have a
 * known budget, and whether the sofa is included is the least of it. So:
 *
 *  - **Preis 25 %** — the hard constraint that ends conversations.
 *  - **Weg zur Arbeit 20 %** — the second one, every day for years.
 *  - **Einzugstermin 20 %** — free before they land, or somebody pays for a
 *    hotel. Previously unscored entirely.
 *  - **Zimmer 15 %**, **Möblierung 15 %** — real preferences, not deciders.
 *  - **Datenlage 5 %** — a nudge towards adverts we can actually judge.
 */
export const DEFAULT_WEIGHTS: RankingWeights = {
  budget: 25,
  commute: 20,
  timing: 20,
  rooms: 15,
  furnishing: 15,
  completeness: 5,
};

// Bumped whenever the meaning of a score changes, so the app knows which
// matches were scored under older rules and re-scores them. This revision
// added the move-in date as a scored dimension and re-weighted the rest.
export const RANK_VERSION = 'rank-2026-08-12c';

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
  /**
   * Purely informational flags. They are shown to the user but must NOT push a
   * listing out of COMPATIBLE — otherwise a condition we can never resolve
   * (e.g. no geocoder configured, so every distance is unknown) would mark the
   * whole inbox as "needs review" and destroy the signal.
   */
  const infoFlags: string[] = [];

  // 0a. Adverts that are not lettable at all, whenever they arrived.
  if (listing.disqualified) {
    blockers.push(listing.disqualified);
  }

  // 0b. Short-stay platforms.
  //
  // Ahead of everything else, because these adverts pass every other test:
  // furnished, central, complete figures, and impossible — they are let by the
  // week, name no move-in date, and end. For anybody arriving to stay, the
  // whole platform is noise; in Notfallmodus, where a roof for six weeks is
  // exactly the point, they are welcome.
  if (listing.shortStayProvider && !profile.temporaryMode) {
    blockers.push('Anbieter für Wohnen auf Zeit — kein dauerhafter Mietvertrag');
  }

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
    // Only the Kaltmiete is known — which is the normal case for the ads
    // automatic discovery brings in, because most portals publish a single
    // headline price.
    //
    // The Kaltmiete is a *lower bound* on the Warmmiete: nothing can make the
    // total cheaper than the cold rent. So the same thresholds apply, and they
    // apply honestly — a 1.800 € cold rent cannot fit a 900 € warm budget under
    // any imaginable Nebenkosten. Treating that as merely "worth a look",
    // which is what the old soft flag did, made the budget filter meaningless
    // once the pool filled with such ads: everything came back "fast passend".
    if (listing.kaltMieteCents > cap * 1.15) {
      blockers.push('Deutlich über Budget (schon die Kaltmiete)');
    } else if (listing.kaltMieteCents > cap) {
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
  } else {
    // No commute time and no geocoded distance — the normal case here, because
    // this deployment runs without a geocoder. Fall back to the postcode, which
    // cannot confirm that a flat is close but can reliably tell that it is not:
    // a different postal zone is hundreds of kilometres, essentially always.
    // Without this, a Köln candidate was shown Bad Rappenau flats at 86 points
    // and "Passend", because an unknown distance scored as merely neutral.
    const postal = postalProximity(profile.workplacePostalCode, listing.locationPostal);
    if (postal.proximity === 'FAR') {
      blockers.push(postal.label!);
    } else if (postal.proximity === 'NEARBY_ZONE') {
      softFlags.push(postal.label!);
    } else if (postal.proximity === 'UNKNOWN') {
      infoFlags.push(
        cityMismatch(profile.workplaceCity, listing.locationCity)
          ? `Anderer Ort (${listing.locationCity}) — Entfernung unbekannt`
          : 'Entfernung unbekannt',
      );
    }
  }

  // Insufficient-data escalation: type unknown + no rooms + no cost → we cannot
  // even say near-match. That's an INSUFFICIENT_DATA listing.
  const hasAnySignal =
    listing.rooms != null || listing.effectiveMonthlyCents != null || listing.propertyType !== 'UNKNOWN';

  const allFlags = [...softFlags, ...infoFlags];
  if (blockers.length > 0) return { compatibility: 'INCOMPATIBLE', blockers, softFlags: allFlags };
  if (!hasAnySignal) return { compatibility: 'INSUFFICIENT_DATA', blockers, softFlags: allFlags };
  // Only flags that genuinely need a human decision downgrade to NEAR_MATCH.
  if (softFlags.length > 0) return { compatibility: 'NEAR_MATCH', blockers, softFlags: allFlags };
  return { compatibility: 'COMPATIBLE', blockers, softFlags: allFlags };
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
  // Judge against what the flat will actually cost, not against the number the
  // advert happened to print. Two thirds of the pool state only a Kaltmiete,
  // and comparing that bare figure with a Warmmiete cap let a 900 € flat pass
  // a 1000 € budget and then cost 1150 € — generous in the one direction that
  // wastes a candidate's time.
  const rent = assessRent({
    kaltMieteCents: l.kaltMieteCents,
    warmMieteCents: l.monthlyTotalComplete ? l.effectiveMonthlyCents : null,
    livingSpaceSqm: l.livingSpaceSqm,
  });
  const eff = rent.basisCents ?? l.effectiveMonthlyCents;
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
  if (rent.basisKind === 'ESTIMATED') {
    // Within budget on an estimate is a weaker statement than within budget on
    // a stated total, so it scores lower — but it is no longer the blind
    // optimism of judging a Kaltmiete against a Warmmiete cap.
    return {
      pct: Math.max(50, pct - 12),
      reason: `Innerhalb Budget (ca. ${Math.round(eff / 100)} € warm geschätzt)`,
    };
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

/**
 * Does the flat exist by the time the person does?
 *
 * A flat free before the arrival is worth full marks; every night of gap after
 * it is a night in a hotel somebody has to pay for, so the score falls with the
 * gap and floors out at a month, by which point another flat is cheaper.
 *
 * An advert with no date at all scores below a flat that is merely a fortnight
 * late — deliberately. "Frei ab" is the first thing a real letting advert
 * states; leaving it out is what the short-stay platforms do, and a flat we
 * cannot place on the timeline is one nobody can plan around.
 */
export function timingSubscore(
  l: RankingListing,
  p: RankingProfile,
): { pct: number; reason: string } {
  const arrival = p.moveInDate ?? null;
  if (!arrival) {
    // No arrival date on the profile is our gap, not the advert's. Neutral, so
    // a case without one is not silently scored down across the board.
    return { pct: 70, reason: 'Kein Ankunftsdatum im Profil hinterlegt' };
  }
  if (!l.availableFrom) {
    return { pct: 35, reason: 'Anzeige nennt kein Einzugsdatum' };
  }

  const day = 86_400_000;
  const gapDays = Math.round((l.availableFrom.getTime() - arrival.getTime()) / day);

  if (gapDays <= 0) {
    const earlyDays = Math.abs(gapDays);
    // Very early is fine but not free: the rent starts before anybody moves in.
    if (earlyDays > 60) {
      return { pct: 80, reason: `Frei ${earlyDays} Tage vor Ankunft — Miete läuft vorher an` };
    }
    return { pct: 100, reason: 'Frei vor der Ankunft' };
  }
  if (gapDays <= 7) return { pct: 80, reason: `${gapDays} Tage Lücke — mit kurzer Überbrückung machbar` };
  if (gapDays <= 30) return { pct: 50, reason: `${gapDays} Tage Lücke bis zum Einzug` };
  return { pct: 15, reason: `Erst ${gapDays} Tage nach Ankunft frei` };
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

/**
 * Nothing scores 100.
 *
 * A hundred would claim the flat is exactly what the person asked for, with
 * nothing left to find out — and there is always something: the advert does
 * not say when it is free, the address is a district rather than a street, the
 * Nebenkosten are an estimate. A live list showed a 100 sitting next to three
 * chips saying what was missing from that very advert, which is the tool
 * contradicting itself in the space of one row.
 *
 * So the ceiling is 99, and every unknown lowers it further. The cap is not a
 * penalty on top of the score — it is the honest maximum: an advert whose
 * distance we cannot compute cannot be better than "probably fine", whatever
 * its rent and rooms say.
 */
export const MAX_SCORE = 99;

export function certaintyCap(
  l: RankingListing,
  p: RankingProfile,
): { cap: number; missing: string[] } {
  const caps: Array<{ at: number; label: string }> = [];

  if (l.distanceKm == null && l.commuteMinutes == null) {
    caps.push({ at: 85, label: 'Entfernung unbekannt' });
  }
  if (p.moveInDate && !l.availableFrom) {
    caps.push({ at: 82, label: 'kein Einzugsdatum' });
  }
  if (!l.monthlyTotalComplete) {
    caps.push({ at: 92, label: 'Gesamtkosten geschätzt' });
  }
  if (l.rooms == null) caps.push({ at: 88, label: 'Zimmerzahl unbekannt' });
  if (l.propertyType === 'UNKNOWN') caps.push({ at: 88, label: 'Objekttyp unbekannt' });
  if (p.furnished !== 'EITHER' && l.furnishing === 'UNKNOWN') {
    caps.push({ at: 92, label: 'Möblierung unbekannt' });
  }

  const cap = caps.reduce((lowest, c) => Math.min(lowest, c.at), MAX_SCORE);
  return { cap, missing: caps.map((c) => c.label) };
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
  const timing = timingSubscore(listing, profile);

  const weightedTotal =
    (furn.pct * weights.furnishing +
      rooms.pct * weights.rooms +
      bud.pct * weights.budget +
      comm.pct * weights.commute +
      comp.pct * weights.completeness +
      timing.pct * weights.timing) /
    (weights.furnishing +
      weights.rooms +
      weights.budget +
      weights.commute +
      weights.completeness +
      weights.timing);

  const { cap } = certaintyCap(listing, profile);

  const breakdown: ScoreBreakdown = {
    cap,
    furnishing: furn.pct,
    rooms: rooms.pct,
    budget: bud.pct,
    commute: comm.pct,
    completeness: comp.pct,
    timing: timing.pct,
    total: Math.min(cap, Math.round(weightedTotal)),
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
  pushReason('timing', timing);
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
      breakdown: { cap: 0, furnishing: 0, rooms: 0, budget: 0, commute: 0, completeness: 0, timing: 0, total: 0 },
      reasons: cls.blockers.map((b) => `x ${b}`),
      blockers: cls.blockers,
      rankVersion: RANK_VERSION,
    };
  }
  if (cls.compatibility === 'INSUFFICIENT_DATA') {
    return {
      compatibility: cls.compatibility,
      score: 0,
      breakdown: { cap: 0, furnishing: 0, rooms: 0, budget: 0, commute: 0, completeness: 0, timing: 0, total: 0 },
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
