/**
 * "What if we loosened the search?" — re-ranks the listings we already have
 * under a hypothetical profile, without touching the saved one.
 *
 * The point is to answer the question a colleague actually has when the inbox
 * looks empty: *is this a search-criteria problem or a supply problem?* Those
 * need opposite reactions — loosen the filters, or go find more listings — and
 * guessing wrong wastes a day.
 */

import { rank, type RankingListing, type RankingProfile } from '@/domain/ranking';

export interface ProfileOverrides {
  maxWarmmieteCents?: number;
  minRooms?: number;
  maxCommuteMinutes?: number | null;
  radiusKm?: number | null;
  furnished?: RankingProfile['furnished'];
  temporaryMode?: boolean;
}

export interface SimulationCounts {
  compatible: number;
  nearMatch: number;
  incompatible: number;
  insufficient: number;
}

export interface SimulationResult extends SimulationCounts {
  /** Listings that become usable (compatible or near) under this profile. */
  usable: number;
  /** How many more are usable than under the current profile. */
  gained: number;
}

export interface Relaxation {
  key: string;
  label: string;
  overrides: ProfileOverrides;
  /** Usable listings after applying this single change. */
  usable: number;
  gained: number;
}

/** Why the currently unusable listings fail, so the UI can name the real wall. */
export interface BlockerBreakdown {
  budget: number;
  rooms: number;
  commute: number;
  wbs: number;
  propertyType: number;
  furnishing: number;
  other: number;
}

function applyOverrides(base: RankingProfile, o: ProfileOverrides): RankingProfile {
  return {
    ...base,
    maxWarmmieteCents: o.maxWarmmieteCents ?? base.maxWarmmieteCents,
    minRooms: o.minRooms ?? base.minRooms,
    maxCommuteMinutes: o.maxCommuteMinutes !== undefined ? o.maxCommuteMinutes : base.maxCommuteMinutes,
    radiusKm: o.radiusKm !== undefined ? o.radiusKm : base.radiusKm,
    furnished: o.furnished ?? base.furnished,
    temporaryMode: o.temporaryMode ?? base.temporaryMode,
  };
}

export function countUnder(listings: RankingListing[], profile: RankingProfile): SimulationCounts {
  const c: SimulationCounts = { compatible: 0, nearMatch: 0, incompatible: 0, insufficient: 0 };
  for (const l of listings) {
    const r = rank(l, profile);
    if (r.compatibility === 'COMPATIBLE') c.compatible++;
    else if (r.compatibility === 'NEAR_MATCH') c.nearMatch++;
    else if (r.compatibility === 'INCOMPATIBLE') c.incompatible++;
    else c.insufficient++;
  }
  return c;
}

const usableOf = (c: SimulationCounts) => c.compatible + c.nearMatch;

export function simulate(
  listings: RankingListing[],
  base: RankingProfile,
  overrides: ProfileOverrides,
): SimulationResult {
  const before = usableOf(countUnder(listings, base));
  const counts = countUnder(listings, applyOverrides(base, overrides));
  const usable = usableOf(counts);
  return { ...counts, usable, gained: usable - before };
}

/** Groups the blockers of everything currently unusable. */
export function blockerBreakdown(listings: RankingListing[], profile: RankingProfile): BlockerBreakdown {
  const b: BlockerBreakdown = {
    budget: 0,
    rooms: 0,
    commute: 0,
    wbs: 0,
    propertyType: 0,
    furnishing: 0,
    other: 0,
  };
  for (const l of listings) {
    const r = rank(l, profile);
    if (r.compatibility !== 'INCOMPATIBLE') continue;
    const joined = r.blockers.join(' | ').toLowerCase();
    if (joined.includes('budget')) b.budget++;
    else if (joined.includes('zimmer')) b.rooms++;
    else if (joined.includes('anfahrt') || joined.includes('entfernung')) b.commute++;
    else if (joined.includes('wbs')) b.wbs++;
    else if (joined.includes('objekttyp') || joined.includes('tausch') || joined.includes('temporär')) {
      b.propertyType++;
    } else if (joined.includes('möbliert')) b.furnishing++;
    else b.other++;
  }
  return b;
}

/**
 * Tries one loosening at a time and reports which single change unlocks the
 * most listings. One change at a time on purpose: a colleague needs to know
 * *which* constraint is the wall, not that "everything at once" works.
 */
export function suggestRelaxations(
  listings: RankingListing[],
  base: RankingProfile,
  euros = (c: number) => `${Math.round(c / 100)} €`,
): Relaxation[] {
  const before = usableOf(countUnder(listings, base));

  const candidates: Array<{ key: string; label: string; overrides: ProfileOverrides }> = [
    {
      key: 'budget10',
      label: `Budget auf ${euros(Math.round(base.maxWarmmieteCents * 1.1))} erhöhen (+10 %)`,
      overrides: { maxWarmmieteCents: Math.round(base.maxWarmmieteCents * 1.1) },
    },
    {
      key: 'budget20',
      label: `Budget auf ${euros(Math.round(base.maxWarmmieteCents * 1.2))} erhöhen (+20 %)`,
      overrides: { maxWarmmieteCents: Math.round(base.maxWarmmieteCents * 1.2) },
    },
  ];

  if (base.minRooms > 1) {
    candidates.push({
      key: 'rooms',
      label: `Mindest-Zimmer auf ${base.minRooms - 1} senken`,
      overrides: { minRooms: base.minRooms - 1 },
    });
  }
  if (base.maxCommuteMinutes != null) {
    candidates.push({
      key: 'commute',
      label: `Anfahrt bis ${base.maxCommuteMinutes + 15} min zulassen`,
      overrides: { maxCommuteMinutes: base.maxCommuteMinutes + 15 },
    });
  }
  if (base.radiusKm != null) {
    candidates.push({
      key: 'radius',
      label: `Umkreis auf ${base.radiusKm + 10} km erweitern`,
      overrides: { radiusKm: base.radiusKm + 10 },
    });
  }
  if (base.furnished === 'REQUIRED') {
    candidates.push({
      key: 'furnished',
      label: 'Möbliert nur bevorzugt statt zwingend',
      overrides: { furnished: 'PREFERRED' },
    });
  } else if (base.furnished === 'PREFERRED') {
    candidates.push({
      key: 'furnishedEither',
      label: 'Möblierung egal',
      overrides: { furnished: 'EITHER' },
    });
  }
  if (!base.temporaryMode) {
    candidates.push({
      key: 'temporary',
      label: 'Übergangswohnen (Monteurzimmer, Boardinghaus) einbeziehen',
      overrides: { temporaryMode: true },
    });
  }

  return candidates
    .map((c) => {
      const usable = usableOf(countUnder(listings, applyOverrides(base, c.overrides)));
      return { ...c, usable, gained: usable - before };
    })
    .filter((r) => r.gained > 0)
    .sort((a, b) => b.gained - a.gained || a.key.localeCompare(b.key));
}

/**
 * Which individual listings change status under a hypothetical profile.
 *
 * Counts alone answer "how many", but the question a colleague actually has is
 * "which ones" — a slider that promises five more flats is only worth pulling
 * if those five are worth writing to. `T` carries whatever identity the caller
 * needs (title, price, link); this function only decides in or out.
 */
export interface DiffResult<T> {
  /** Usable under the new profile, not under the current one. */
  added: T[];
  /** Usable now, but lost under the new profile. */
  removed: T[];
  /** Usable under both. */
  kept: T[];
}

export function diffUnder<T extends RankingListing>(
  listings: T[],
  base: RankingProfile,
  overrides: ProfileOverrides,
): DiffResult<T> {
  const hypothetical = applyOverrides(base, overrides);
  const out: DiffResult<T> = { added: [], removed: [], kept: [] };

  for (const listing of listings) {
    const before = isUsable(rank(listing, base).compatibility);
    const after = isUsable(rank(listing, hypothetical).compatibility);
    if (after && !before) out.added.push(listing);
    else if (!after && before) out.removed.push(listing);
    else if (after && before) out.kept.push(listing);
  }

  return out;
}

function isUsable(compatibility: string): boolean {
  return compatibility === 'COMPATIBLE' || compatibility === 'NEAR_MATCH';
}

/**
 * The honest headline: loosening only helps if listings exist to loosen onto.
 */
export function diagnose(
  listings: RankingListing[],
  base: RankingProfile,
): { kind: 'NO_LISTINGS' | 'CRITERIA_TOO_TIGHT' | 'SUPPLY_PROBLEM' | 'FINE'; message: string } {
  if (listings.length === 0) {
    return {
      kind: 'NO_LISTINGS',
      message:
        'Es sind noch gar keine Anzeigen importiert. Andere Suchkriterien ändern daran nichts — zuerst Quellen durchgehen und Anzeigen importieren.',
    };
  }
  const counts = countUnder(listings, base);
  if (usableOf(counts) > 0) {
    return { kind: 'FINE', message: `${usableOf(counts)} Anzeigen passen bereits zum aktuellen Profil.` };
  }
  const anyRelaxationHelps = suggestRelaxations(listings, base).length > 0;
  return anyRelaxationHelps
    ? {
        kind: 'CRITERIA_TOO_TIGHT',
        message:
          'Anzeigen sind vorhanden, aber keine erfüllt die aktuellen Kriterien. Eine einzelne Lockerung würde schon helfen.',
      }
    : {
        kind: 'SUPPLY_PROBLEM',
        message:
          'Auch mit deutlich gelockerten Kriterien passt nichts. Das ist ein Angebotsproblem — mehr Quellen durchgehen oder Übergangslösung planen.',
      };
}
