/**
 * Working out Kleinanzeigen's internal number for a town, without guessing.
 *
 * The number is not optional: verified against the live site, a search without
 * one returns nationwide results — asking for Heilbronn and for Berlin both
 * come back with flats in Pegnitz and Plauen. So a missing id does not narrow
 * the search, it silently replaces it with a different one, which is worse than
 * no source at all. That is why the adapter has always required it.
 *
 * Until now the only way to get one was for a colleague to paste a search URL
 * out of their browser, which is a setup step nobody performs, so the source
 * shipped switched off and produced nothing.
 *
 * The way out is that Kleinanzeigen publishes the ids itself. Every category
 * page carries its own region navigation as ordinary links —
 * `/s-wohnung-mieten/bayern/c203l5510`, `/s-wohnung-mieten/berlin/c203l3331` —
 * and a region page lists its towns the same way. So the id can be read from
 * pages the robots.txt already permits, in two hops, with no autocomplete
 * endpoint (which robots.txt disallows) and no guessing.
 */

/** One place the navigation links to, with the id Kleinanzeigen uses for it. */
export interface LocationLink {
  id: string;
  /** URL slug, e.g. "baden-wuerttemberg" or "heilbronn". */
  slug: string;
}

/**
 * Reads every `…/<slug>/c<category>l<id>` link out of a page.
 *
 * Deliberately driven by the URL shape rather than by surrounding markup: the
 * shape is a routing contract that survives redesigns, whereas the nav's CSS
 * classes do not.
 */
export function extractLocationLinks(body: string): LocationLink[] {
  const out = new Map<string, LocationLink>();
  const re = /\/s-[a-z-]+\/([a-z0-9-]+)\/c\d+l(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const slug = m[1].toLowerCase();
    const id = m[2];
    // "0" is Kleinanzeigen's id for all of Germany; accepting it would undo
    // the entire point of resolving a town.
    if (id === '0') continue;
    if (!out.has(slug)) out.set(slug, { id, slug });
  }
  return [...out.values()];
}

/** German place name → the slug Kleinanzeigen uses in its URLs. */
export function citySlug(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface ResolveResult {
  id: string | null;
  /** How it was found, for the settings screen. */
  note: string;
}

/**
 * Two hops: the nationwide page lists the federal states, a state page lists
 * its towns. `fetchBody` is injected so this stays testable and so the caller's
 * crawler keeps enforcing robots.txt and the per-host delay.
 */
export async function resolveCityId(
  city: string,
  fetchBody: (url: string) => Promise<string | null>,
  base = 'https://www.kleinanzeigen.de',
): Promise<ResolveResult> {
  const wanted = citySlug(city);
  if (!wanted) return { id: null, note: 'Kein Ort angegeben.' };

  const root = await fetchBody(`${base}/s-wohnung-mieten/c203`);
  if (!root) return { id: null, note: 'Kleinanzeigen war nicht erreichbar.' };

  const regions = extractLocationLinks(root);

  // A city-state (Berlin, Hamburg, Bremen) is already in the first hop.
  const direct = regions.find((r) => r.slug === wanted);
  if (direct) return { id: direct.id, note: `Ortsnummer ${direct.id} aus der Bundesland-Navigation gelesen.` };

  for (const region of regions) {
    const page = await fetchBody(`${base}/s-wohnung-mieten/${region.slug}/c203l${region.id}`);
    if (!page) continue;
    const hit = extractLocationLinks(page).find((l) => l.slug === wanted);
    if (hit) {
      return { id: hit.id, note: `Ortsnummer ${hit.id} gefunden (${region.slug}).` };
    }
  }

  return {
    id: null,
    note: `„${city}" wurde in der Ortsliste nicht gefunden — bitte eine Such-URL aus dem Browser einfügen.`,
  };
}

/**
 * Checks that a configured id really points at the town we think it does.
 *
 * The failure this prevents is the quiet one: a wrong number returns a full,
 * healthy-looking list of flats in the wrong part of Germany, and nothing about
 * the result says so. Comparing the towns the ads actually came back with
 * against the town we asked for turns that into something visible.
 */
export function verifyLocation(
  expectedCity: string,
  returnedPlaces: Array<string | null | undefined>,
  returnedPostcodes: Array<string | null | undefined> = [],
): { ok: boolean; note: string } {
  const places = returnedPlaces.filter((p): p is string => !!p && p.trim().length > 0);
  const wanted = citySlug(expectedCity);

  // Strongest signal: the town we asked for is named in the results.
  const named = places.filter((p) => {
    const s = citySlug(p);
    return s === wanted || s.includes(wanted) || wanted.includes(s);
  }).length;
  if (named > 0) {
    return { ok: true, note: `${named} von ${places.length} Treffern nennen „${expectedCity}".` };
  }

  // Names alone cannot settle it, because a big city answers with its
  // districts — Berlin returns Neukölln, Kreuzberg, Schöneberg and never the
  // word "Berlin". Postcodes can: a real city search stays inside one postal
  // region, while the nationwide list ranges across all of them.
  const codes = returnedPostcodes
    .filter((c): c is string => !!c && /^\d{5}$/.test(c.trim()))
    .map((c) => c.trim().slice(0, 2));
  //
  // What this can and cannot decide, measured against the live site: a real
  // city search spans a handful of postal regions (Berlin's districts span 4),
  // the nationwide fallback spans upwards of twenty. That gap is wide enough to
  // call reliably, and the nationwide fallback is the failure that actually
  // occurs — it is what a missing or unresolved id produces.
  //
  // It deliberately does *not* claim to catch a wrong-but-valid id (Berlin's
  // number entered for a Heilbronn candidate), because telling one metro area
  // from another needs a postcode gazetteer we do not have. Saying so is
  // better than a check that quietly misses half of what its name implies.
  //
  // Ten is the smallest sample that separates them: on a full result page
  // Berlin's districts land in 4 postal regions and the nationwide list in
  // more than twenty, but on a handful of ads both look equally scattered.
  // Below that the honest answer is "cannot tell", not a coin flip.
  if (codes.length >= 10) {
    const regions = new Set(codes).size;
    if (regions > 6) {
      return {
        ok: false,
        note: `Treffer aus ${regions} Postleitzahl-Regionen im ganzen Bundesgebiet — das ist die bundesweite Liste, die Ortsnummer greift nicht.`,
      };
    }
    return {
      ok: true,
      note: `Treffer aus ${regions} Postleitzahl-Region(en) (${[...new Set(codes)].sort().join(', ')}xxx) — plausibel für eine Stadt samt Umland.`,
    };
  }

  if (places.length === 0) return { ok: true, note: 'Keine Orte in der Antwort — nicht prüfbar.' };
  return { ok: true, note: 'Zu wenige Daten für eine verlässliche Prüfung.' };
}
