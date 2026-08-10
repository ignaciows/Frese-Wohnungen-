/**
 * "Is this actually a flat?"
 *
 * The generic adapters buy breadth at the cost of precision. A link-list
 * adapter pointed at a landlord's site happily returns the navigation as well
 * as the adverts — a live run against Gewobag brought back "Lagerraum",
 * "Gewerberäume", "E-Stellplatz" and "Immobilien Archiv" alongside the real
 * flats. Ranking would eventually mark those unusable, but they would still
 * sit in the list, and a list you have to mentally filter is the thing this
 * tool exists to remove.
 *
 * So a discovered item has to clear a low bar before it enters the pool:
 * nothing that is obviously *not* housing, and at least one positive signal
 * that it is. The bar is deliberately low — a thin but real advert must get
 * through, because a missed flat costs far more than one stray row.
 */

import type { StructuredHints } from '@/domain/parser';

export interface PlausibilityInput {
  title: string;
  description?: string;
  structured?: StructuredHints;
  /** The advert's own URL, when known. See LISTING_URL_PATTERNS. */
  url?: string;
}

export interface PlausibilityResult {
  plausible: boolean;
  /** Why it was rejected, for the discovery log. Empty when accepted. */
  reason: string;
}

/**
 * Things that are let, but are not somewhere to live. Anchored to whole words
 * so "Stellplatz inklusive" in a flat's description cannot reject it — these
 * are matched against the title only, where they mean the whole advert.
 */
const NOT_HOUSING = [
  /\bgewerbe\w*/i,
  /\bb(ü|ue)ro(fl(ä|ae)che|raum|r(ä|ae)ume)?\b/i,
  /\bladenlokal\b/i,
  /\beinzelhandelsfl(ä|ae)che\b/i,
  /\blagerraum\b/i,
  /\blagerfl(ä|ae)che\b/i,
  /\bhalle\b/i,
  /\bstellplatz\b/i,
  /\bstellpl(ä|ae)tze\b/i,
  /\bparkplatz\b/i,
  /\btiefgaragenplatz\b/i,
  /\bgarage\b/i,
  /\bgrundst(ü|ue)ck\b/i,
  /\barchiv\b/i,
  /\bpraxis(fl(ä|ae)che|raum)?\b/i,
  /\bwerkstatt\b/i,
  /\batelier\b/i,
  /\bcoworking\b/i,
  // Navigation and marketing pages a link-list adapter picks up.
  /\b(übersicht|uebersicht)\b/i,
  /\bnewsletter\b/i,
  /\bmerkliste\b/i,
  /\bsuchauftrag\b/i,
  /\bimpressum\b/i,
  /\bdatenschutz\b/i,
];

/** Words that mean somewhere a person lives. */
const HOUSING_WORDS =
  /\b(wohnung(en)?|zimmer|apartment|appartement|wohnen|maisonette|penthouse|studio|loft|wg|einliegerwohnung|dachgeschoss|erdgeschoss|whg)\b/i;

/** A title that is clearly a placeholder from a link with no text. */
const PLACEHOLDER_TITLE = /titel folgt bei detailpr(ü|ue)fung/i;

/**
 * URL shapes that only ever belong to one advert's detail page.
 *
 * This matters for the link-list adapter: plenty of portals wrap the advert
 * link around a photo, so the anchor carries no text and there is nothing to
 * read yet. A live Immowelt run produced 31 perfectly good `/expose/…` links
 * that the wording checks alone threw away. The path is structural — a portal
 * does not put its newsletter page under `/expose/12345` — so it is trusted
 * enough to let the item through and let the detail read decide.
 *
 * A title that explicitly says "Gewerbe" or "Stellplatz" is still checked
 * first, so this cannot resurrect an advert we already know is not a home.
 */
const LISTING_URL_PATTERNS = [
  /\/expose\/[^/]+/i,
  /\/s-anzeige\//i,
  /\/mietangebot(e)?\/[^/]+/i,
  /\/immobilie[n]?\/[^/]*\d/i,
  /\/objekt[e]?\/[^/]*\d/i,
  /\/wohnung(en)?\/[^/]*\d/i,
];

export function isPlausibleHousing(input: PlausibilityInput): PlausibilityResult {
  const title = (input.title ?? '').trim();
  const description = (input.description ?? '').trim();

  if (title.length < 3) return { plausible: false, reason: 'Kein Titel' };

  // A title-only match: these words in a *title* describe the whole advert.
  const notHousing = NOT_HOUSING.find((p) => p.test(title));
  if (notHousing) {
    return { plausible: false, reason: `Kein Wohnraum (Titel enthält „${title.match(notHousing)?.[0]}")` };
  }

  const structured = input.structured ?? {};
  const hasMeasurement =
    (structured.rooms ?? 0) > 0 ||
    (structured.livingSpaceSqm ?? 0) > 0 ||
    (structured.warmMieteCents ?? 0) > 0 ||
    (structured.kaltMieteCents ?? 0) > 0;

  // A number from the result list is the strongest signal there is: navigation
  // never comes with a room count or a rent.
  if (hasMeasurement) return { plausible: true, reason: '' };

  const text = `${title}\n${description}`;
  if (HOUSING_WORDS.test(text)) {
    // The enrichment step will fill in the rest; a placeholder title with
    // housing wording in the body is still worth following.
    return { plausible: true, reason: '' };
  }

  // A structural listing URL is trustworthy on its own; the detail read will
  // supply the title and figures the anchor did not carry.
  if (input.url && LISTING_URL_PATTERNS.some((p) => p.test(pathOf(input.url!)))) {
    return { plausible: true, reason: '' };
  }

  // A placeholder title with nothing else known is a link we cannot judge yet.
  // Let it through only when the description says something — otherwise it is
  // almost certainly navigation.
  if (PLACEHOLDER_TITLE.test(title) && description.length > 40) {
    return { plausible: true, reason: '' };
  }

  return {
    plausible: false,
    reason: 'Weder Zimmer/Fläche/Miete noch ein Hinweis auf Wohnraum erkennbar',
  };
}

/** Path only: a query string can contain anything and proves nothing. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
