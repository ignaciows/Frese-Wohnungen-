/**
 * "Is this flat anywhere near the job?" — answered without a geocoder.
 *
 * Distance filtering only works when `distanceKm` is known, and that needs a
 * geocoder, which this deployment does not run (GEOCODER=none). So every ad
 * scored as if its location were merely *unknown* — a neutral 40 % on the
 * commute component — and nothing anywhere compared the two place names.
 *
 * The visible result: a candidate working in Köln was shown a flat in Bad
 * Rappenau, 250 km away, rated 86 points and labelled "Passend". Confidently
 * wrong is worse than admitting ignorance, and it is the kind of error that
 * costs a colleague an afternoon before anyone notices.
 *
 * German postal codes fix this cheaply. The leading digits are geographic: the
 * first digit is a zone spanning a few hundred kilometres, the first two a
 * region typically under a hundred. So without knowing where anything actually
 * is, we can still tell "different end of the country" from "next town over".
 *
 * This deliberately never *confirms* proximity — two neighbouring towns can sit
 * either side of a zone boundary, and identical prefixes still leave 40 km of
 * room. It only rules things out, which is the direction that can be done
 * safely without real coordinates.
 */

export type PostalProximity =
  /** Same postal region — as close as this method can tell. */
  | 'SAME_REGION'
  /** Same zone, different region: usually 30–120 km. Worth flagging. */
  | 'NEARBY_ZONE'
  /** Different zone: hundreds of kilometres, essentially always. */
  | 'FAR'
  /** One of the codes is missing or malformed. */
  | 'UNKNOWN';

export interface PostalDistanceResult {
  proximity: PostalProximity;
  /** German, ready for a flag or a blocker. */
  label: string | null;
}

/**
 * Cities that span more than one two-digit prefix.
 *
 * The two-digit rule breaks exactly where it matters most: on the big cities,
 * which is where the flats are. Hamburg runs from 20095 to 22769, so a job in
 * Altona (22765) and a flat in Rotherbaum (20146) — six kilometres apart, one
 * S-Bahn ride — came out as "Andere PLZ-Region". That is a soft flag, and a
 * soft flag permanently downgrades a listing to "Fast passend": on the live
 * screen an 82-point Hamburg flat sat under a green score with a label saying
 * it did not quite fit. Nothing was wrong with the flat.
 *
 * Each set is one contiguous metropolitan area whose prefixes are neighbours
 * on the ground. Sources: the Deutsche Post postcode ranges for each city.
 * Kept deliberately small — only cities that genuinely straddle a boundary —
 * because every entry here is a claim that two prefixes are commutable, and a
 * wrong one hides the very error this file exists to catch.
 */
const METRO_PREFIXES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['20', '21', '22']), // Hamburg
  new Set(['10', '12', '13', '14']), // Berlin
  new Set(['80', '81']), // München
  new Set(['50', '51']), // Köln
  new Set(['40', '41']), // Düsseldorf
  new Set(['60', '65']), // Frankfurt am Main / Offenbach
  new Set(['70', '71']), // Stuttgart
  new Set(['04']), // Leipzig — single prefix, listed for completeness
  new Set(['30', '31']), // Hannover
  new Set(['28']), // Bremen
  new Set(['90', '91']), // Nürnberg / Fürth
  new Set(['44', '45']), // Dortmund / Essen / Bochum — the Ruhr runs together
  new Set(['01']), // Dresden
];

/** True when both codes sit inside one metropolitan area. */
function sameMetro(a: string, b: string): boolean {
  const pa = a.slice(0, 2);
  const pb = b.slice(0, 2);
  return METRO_PREFIXES.some((set) => set.has(pa) && set.has(pb));
}

const GERMAN_POSTCODE = /^\d{5}$/;

function clean(code: string | null | undefined): string | null {
  const c = (code ?? '').trim();
  return GERMAN_POSTCODE.test(c) ? c : null;
}

/**
 * Compares a listing's postcode with the workplace's.
 *
 * Only called when no real distance is available — a geocoded distance is
 * always better and takes precedence at the call site.
 */
export function postalProximity(
  workplacePostal: string | null | undefined,
  listingPostal: string | null | undefined,
): PostalDistanceResult {
  const work = clean(workplacePostal);
  const listing = clean(listingPostal);
  if (!work || !listing) return { proximity: 'UNKNOWN', label: null };

  if (work.slice(0, 2) === listing.slice(0, 2) || sameMetro(work, listing)) {
    return { proximity: 'SAME_REGION', label: null };
  }

  if (work[0] === listing[0]) {
    return {
      proximity: 'NEARBY_ZONE',
      label: `Andere PLZ-Region (${listing.slice(0, 2)} statt ${work.slice(0, 2)}) — Entfernung prüfen`,
    };
  }

  return {
    proximity: 'FAR',
    label: `Ganz andere Gegend (PLZ ${listing.slice(0, 2)} statt ${work.slice(0, 2)}) — mehrere hundert Kilometer entfernt`,
  };
}

/**
 * Fallback for ads that carry a town name but no postcode.
 *
 * Much weaker than the postcode comparison and used only to say "we cannot
 * confirm this is near the job", never to rule anything out: a different town
 * name is the normal case for a suburb ten minutes away.
 */
export function cityMismatch(
  workplaceCity: string | null | undefined,
  listingCity: string | null | undefined,
): boolean {
  const a = (workplaceCity ?? '').trim().toLowerCase();
  const b = (listingCity ?? '').trim().toLowerCase();
  if (!a || !b) return false;
  return !(a === b || a.includes(b) || b.includes(a));
}
