/**
 * Kleinanzeigen result-list adapter.
 *
 * Kleinanzeigen carries a large share of the private, no-agent-fee flats that
 * matter most for our candidates, and it was the source colleagues complained
 * was missing entirely. Its search pages are plain server-rendered HTML.
 *
 * **What its robots.txt permits shapes this adapter.** Checked against the
 * live file: the plain city search (`/s-wohnung-mieten/<ort>/c203l<id>`), its
 * `seite:N` pagination and every `/s-anzeige/…` detail page are allowed, while
 * three things we would otherwise have reached for are explicitly disallowed:
 *
 *   - the price filter (`preis::900`) and the offers filter (`anzeige:angebote`),
 *   - the radius suffix (`…l9228r20`),
 *   - the location autocomplete (`/s-ort-empfehlungen.json`).
 *
 * So the adapter asks for the unfiltered city list and lets our own ranking do
 * the filtering — which costs a little more parsing and, usefully, returns
 * *more* ads rather than fewer.
 *
 * The town's internal id is not optional — verified live, a search without one
 * returns nationwide results rather than none, so a missing id silently swaps
 * the search rather than narrowing it. The autocomplete that would resolve it
 * is disallowed, but the portal publishes the same ids in its own region
 * navigation, so `prepare` reads them from there (see kleinanzeigenLocations).
 * Guessing an id was never an option — a wrong one returns another town's flats
 * and looks perfectly healthy doing it.
 *
 * Cover the surrounding area by listing several `locationIds`, which is the
 * permitted equivalent of a radius search.
 */

import {
  cfgString,
  cfgStringList,
  type AdapterConfig,
  type DiscoveredListing,
  type DiscoveryAdapter,
  type DiscoveryQuery,
  type FetchedPage,
} from '../types';
import {
  cachedLocationId,
  citySlug,
  LOCATION_CACHE_KEY,
  resolveCityId,
  withCachedLocationId,
} from './kleinanzeigenLocations';
import { listPostedAt } from '../listPostedAt';
import {
  absoluteUrl,
  decodeEntities,
  firstMatch,
  parseGermanNumber,
  parsePriceCents,
  splitByMarker,
  textOf,
} from '../html';

const BASE = 'https://www.kleinanzeigen.de';
/**
 * 203 = Mietwohnungen, 199 = WG-Zimmer & Wohnen auf Zeit.
 *
 * There is no third number. 201 was used here for "Temporäres Wohnen" and does
 * not exist: every path built with it — `/s-wohnung-mieten/koeln/c201l945`,
 * `/s-wohnen-auf-zeit/koeln/c201l945` — answers 200 after quietly redirecting
 * to `/s-koeln/l945`, which is the whole of Cologne's marketplace. The result
 * list parsed cleanly, so a sweep for a Cologne candidate brought back a
 * hundred and three jeans, VW wheel caps and job adverts as flats.
 *
 * Temporary lets are not lost with it: they sit in 199, which returns the
 * Zwischenmiete and Monteurzimmer adverts under its own name.
 */
const CATEGORY_FLATS = 'c203';
const CATEGORY_WG = 'c199';
/** robots.txt disallows `/*​/seite:N*` from page 60 upward; we never go near it. */
const MAX_PAGE = 20;

export const kleinanzeigenAdapter: DiscoveryAdapter = {
  key: 'kleinanzeigen',
  label: 'Kleinanzeigen — Ergebnisliste',
  description:
    'Liest die Ergebnisliste von kleinanzeigen.de. Preis- und Umkreisfilter sind laut robots.txt gesperrt, daher wird die ungefilterte Ortsliste gelesen und hier gefiltert — das liefert eher mehr Treffer als weniger.',
  configKeys: [
    {
      key: 'locationIds',
      // Optional since the adapter resolves the number from the portal's own
      // published region navigation (see `prepare`). Setting it by hand still
      // wins, and is the way to cover several towns at once — the permitted
      // stand-in for the radius filter robots.txt disallows.
      required: false,
      hint: 'Optional. Wird sonst automatisch aus dem Ort jedes Kandidaten ermittelt. Mehrere Nummern (eine pro Zeile) decken das Umland ab — bei …/c203l9228 ist 9228 die Nummer. Nur zusammen mit „locationCity" ausfüllen, sonst gilt sie für keinen Ort.',
    },
    {
      key: 'locationCity',
      required: false,
      hint: 'Zu welchem Ort die oben eingetragenen Nummern gehören, z. B. „Heilbronn". Ohne diese Angabe werden die Nummern ignoriert und der Ort jedes Kandidaten einzeln ermittelt — sonst bekämen Kandidaten aus anderen Städten die Wohnungen dieses Ortes.',
    },
    {
      key: 'searchUrl',
      required: false,
      hint: 'Alternative: eine Such-URL aus dem Browser einfügen — die Ortsnummer wird daraus gelesen.',
    },
    {
      key: 'includeWgRooms',
      required: false,
      hint: 'true, wenn zusätzlich WG-Zimmer gesucht werden sollen.',
    },
  ],

  /**
   * Fills in the town's number when nobody configured one.
   *
   * This is what made the source produce nothing: the number was mandatory,
   * the only way to get it was to paste a search URL out of a browser, and so
   * the source shipped switched off. Reading it from the portal's own region
   * navigation removes that setup step — and the check matters more than the
   * convenience, because a search without the number silently returns
   * nationwide results rather than no results.
   */
  async prepare(query, config, fetchPage) {
    const city = query.city?.trim() || null;
    const configured = resolveLocationIds(config);

    if (configured.length > 0) {
      // A hand-entered list of numbers is a deliberate override — but it was
      // entered while thinking of one particular town, and the source is
      // shared by every candidate. Reusing it for all of them is how a nurse
      // starting in Cologne came to be shown Heilbronn: the first candidate's
      // number had been stored on the source, `prepare` saw it and returned
      // early, and every later city was searched in Heilbronn under its own
      // name. So the override only counts for the town it was entered for.
      const forCity = cfgString(config, 'locationCity');
      if (!city || (forCity && citySlug(forCity) === citySlug(city))) return config;
    }

    if (!city) return null;

    // Resolving costs a page per federal state walked, so the answer is kept
    // per city rather than re-walked for every candidate on every sweep.
    const cached = cachedLocationId(config, city);
    if (cached) return { ...config, locationIds: [cached] };

    const { id } = await resolveCityId(city, async (url) => {
      const page = await fetchPage(url);
      return page.body;
    });
    if (!id) return null;

    return {
      ...config,
      locationIds: [id],
      [LOCATION_CACHE_KEY]: withCachedLocationId(config, city, id),
    };
  },

  buildUrls(query, config) {
    const locationIds = resolveLocationIds(config);
    // Without a town number Kleinanzeigen answers with the nationwide list, so
    // an unresolved town must produce no request at all — a flat in Passau for
    // a nurse starting in Heilbronn is worse than an empty result.
    if (locationIds.length === 0) return [];

    const categories =
      query.includeTemporary || config.includeWgRooms === true
        ? [CATEGORY_FLATS, CATEGORY_WG]
        : [CATEGORY_FLATS];

    const citySlug = query.city ? slug(query.city) : null;
    const pages = Math.min(MAX_PAGE, Math.max(1, query.maxPages));

    const urls: string[] = [];
    for (const locationId of locationIds) {
      for (const category of categories) {
        for (let page = 1; page <= pages; page++) {
          const segments = ['s-wohnung-mieten'];
          if (page > 1) segments.push(`seite:${page}`);
          if (citySlug) segments.push(citySlug);
          segments.push(`${category}l${locationId}`);
          urls.push(`${BASE}/${segments.join('/')}`);
        }
      }
    }
    return urls;
  },

  parse(page) {
    if (!page.body) return [];
    // A category that does not exist is not answered with an error. The portal
    // redirects to the town's whole marketplace and returns 200, and the page
    // parses perfectly — into jeans, wheel caps and job adverts. Comparing the
    // category we asked for with the one we ended up on is the only signal
    // that this happened.
    if (droppedCategory(page.url, page.finalUrl)) return [];
    // Kleinanzeigen content-negotiates: the same permitted URL answers with a
    // JSON view when the request accepts JSON. That view is both richer and
    // far less brittle than the markup, so it is the primary path — but the
    // HTML parser stays as a fallback in case the negotiation ever stops.
    const trimmed = page.body.trimStart();
    if (trimmed.startsWith('{')) {
      const fromJson = parseJsonResults(trimmed, page.finalUrl ?? page.url);
      if (fromJson) return fromJson;
    }
    return parseHtmlResults(page.body, page.finalUrl ?? page.url);
  },
};

/* --------------------------------------------------------------- json --- */

interface AdPreview {
  sortingDate?: unknown;
  title?: unknown;
  description?: unknown;
  seoLink?: unknown;
  price?: unknown;
  locationName?: unknown;
  parentLocationName?: unknown;
  attributes?: unknown;
  imageList?: unknown;
  posterType?: unknown;
  company?: unknown;
}

function parseJsonResults(body: string, base: string): DiscoveredListing[] | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }

  const result = data.result as Record<string, unknown> | undefined;
  const rows = result?.resultList;
  if (!Array.isArray(rows)) return null;

  // The portal states which figure its price field holds. Believing it beats
  // guessing: "Kaltmiete" and "Warmmiete" rank very differently.
  const priceLabel = String(
    (data.searchForm as Record<string, unknown> | undefined)?.priceLabelMessageKey ?? '',
  ).toLowerCase();
  const priceIsWarm = priceLabel.includes('warm');

  const out: DiscoveredListing[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const ad = (row as Record<string, unknown>).organicAdPreview as AdPreview | undefined;
    if (!ad) continue;

    const link = typeof ad.seoLink === 'string' ? ad.seoLink : null;
    const title = typeof ad.title === 'string' ? ad.title.trim() : null;
    if (!link || !title) continue;
    const url = absoluteUrl(link, base);
    if (!url) continue;

    const priceCents = parsePriceCents(typeof ad.price === 'string' ? ad.price : null);
    const { rooms, sqm } = parseAttributes(ad.attributes);

    const postal = typeof ad.locationName === 'string' ? ad.locationName.trim() : '';
    const city = typeof ad.parentLocationName === 'string' ? ad.parentLocationName.trim() : '';
    const company = ad.company as { name?: unknown } | undefined;

    out.push({
      url,
      title,
      description: typeof ad.description === 'string' ? ad.description : '',
      locationRaw: [postal, city].filter(Boolean).join(' '),
      locationPostal: /^\d{5}$/.test(postal) ? postal : null,
      locationCity: city || null,
      imageUrl: firstImage(ad.imageList),
      contactName: typeof company?.name === 'string' ? company.name : null,
      // Kleinanzeigen states the date right in the list — a German date, or
      // "Heute"/"Gestern" for the newest ads, which are the ones worth acting
      // on fastest.
      postedAt: typeof ad.sortingDate === 'string' ? listPostedAt(ad.sortingDate) : null,
      structured: priceIsWarm ? { warmMieteCents: priceCents, rooms, livingSpaceSqm: sqm } : { kaltMieteCents: priceCents, rooms, livingSpaceSqm: sqm },
    });
  }

  return out;
}

/** `["47,15 m²", "2 Zi."]` → { sqm: 47.15, rooms: 2 }. */
function parseAttributes(attributes: unknown): { rooms: number | null; sqm: number | null } {
  if (!Array.isArray(attributes)) return { rooms: null, sqm: null };
  let rooms: number | null = null;
  let sqm: number | null = null;
  for (const raw of attributes) {
    if (typeof raw !== 'string') continue;
    if (sqm == null && /m²|m2/i.test(raw)) sqm = parseGermanNumber(raw);
    else if (rooms == null && /zi\.?|zimmer/i.test(raw)) rooms = parseGermanNumber(raw);
  }
  return { rooms, sqm };
}

function firstImage(imageList: unknown): string | null {
  if (!Array.isArray(imageList) || imageList.length === 0) return null;
  const first = imageList[0] as Record<string, unknown>;
  for (const key of ['adTableThumbnailLargeUrl', 'xLargeUrl', 'adTableThumbnailUrl']) {
    const value = first?.[key];
    if (typeof value === 'string' && value.startsWith('http')) return value;
  }
  return null;
}

/* --------------------------------------------------------------- html --- */

function parseHtmlResults(body: string, base: string): DiscoveredListing[] {
  {
    const out: DiscoveredListing[] = [];

    for (const card of splitByMarker(body, /<article class="aditem"/)) {
      const href =
        firstMatch(card, /data-href="([^"]+)"/) ?? firstMatch(card, /href="(\/s-anzeige\/[^"]+)"/);
      if (!href) continue;
      const url = absoluteUrl(href, base);
      if (!url) continue;

      const title =
        firstMatch(card, /class="ellipsis"[^>]*>([^<]+)</) ??
        firstMatch(card, /<h2[^>]*>\s*<a[^>]*>([^<]+)</);
      if (!title) continue;

      // The card's JSON-LD image block carries a longer teaser than the <p>.
      const jsonTeaser = firstMatch(card, /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const htmlTeaser = firstMatch(card, /middle--description">([\s\S]*?)<\/p>/);
      const description = unescapeJson(jsonTeaser) ?? (htmlTeaser ? textOf(htmlTeaser) : '');

      const { locationRaw, postal, city } = splitLocation(
        firstMatch(card, /icon-pin-gray"[^>]*><\/i>([\s\S]*?)<\/div>/),
      );

      const priceCents = parsePriceCents(firstMatch(card, /price-shipping--price">([\s\S]*?)<\/p>/));
      const { rooms, sqm } = parseTags(firstMatch(card, /middle--tags">([\s\S]*?)<\/p>/));

      out.push({
        url,
        title: textOf(title),
        description,
        locationRaw,
        locationCity: city,
        locationPostal: postal,
        imageUrl: firstMatch(card, /<img[^>]+src="(https:\/\/img\.kleinanzeigen\.de[^"]+)"/),
        structured: {
          // The HTML view, unlike the JSON one, does not label its price. The
          // portal's own filter is on the Kaltmiete, so that is the reading —
          // and it errs in the safe direction, understating a flat's appeal
          // rather than overstating it.
          kaltMieteCents: priceCents,
          rooms,
          livingSpaceSqm: sqm,
        },
      });
    }

    return out;
  }
}

/** Accepts a list of ids, or digs one out of a pasted search URL. */
export function resolveLocationIds(config: AdapterConfig): string[] {
  const ids = cfgStringList(config, 'locationIds')
    .map((v) => v.replace(/^l/i, '').trim())
    .filter((v) => /^\d+$/.test(v));

  const fromUrl = extractLocationId(cfgString(config, 'searchUrl'));
  if (fromUrl) ids.push(fromUrl);

  // "0" is Kleinanzeigen's id for all of Germany — accepting it would flood the
  // pool with ads hundreds of kilometres from the workplace.
  return [...new Set(ids)].filter((id) => id !== '0');
}

/** ".../c203l9228r20" → "9228". */
export function extractLocationId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/c\d+l(\d+)/);
  return m ? m[1] : null;
}

/** The `c<category>l<location>` token a search URL is addressed by. */
const CATEGORY_IN_PATH = /\/c(\d+)l\d+/;

/**
 * True when a redirect moved us off the category we asked for.
 *
 * Exported for the test that pins the live behaviour: asking for
 * `/s-wohnung-mieten/koeln/c201l945` lands on `/s-koeln/l945`, and everything
 * downstream would treat that town-wide marketplace as a list of flats.
 */
export function droppedCategory(requested: string, final: string | null): boolean {
  if (!final) return false;
  const wanted = requested.match(CATEGORY_IN_PATH)?.[1];
  if (!wanted) return false;
  return final.match(CATEGORY_IN_PATH)?.[1] !== wanted;
}

function slug(city: string): string {
  return city
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** "74072 Heilbronn (0.8 km)" → postal 74072, city Heilbronn. */
function splitLocation(block: string | null): {
  locationRaw: string;
  postal: string | null;
  city: string | null;
} {
  if (!block) return { locationRaw: '', postal: null, city: null };
  const flat = textOf(block)
    .replace(/\s*\([\d.,]+\s*km\)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = flat.match(/^(\d{5})\s+(.+)$/);
  if (m) return { locationRaw: flat, postal: m[1], city: m[2].trim() };
  return { locationRaw: flat, postal: null, city: flat || null };
}

/** "47,15 m² · 2 Zi. · Online-Besichtigung" → { sqm: 47.15, rooms: 2 }. */
function parseTags(tags: string | null): { rooms: number | null; sqm: number | null } {
  if (!tags) return { rooms: null, sqm: null };
  const flat = decodeEntities(tags).replace(/<[^>]+>/g, ' ');
  const sqmMatch = flat.match(/([\d.,]+)\s*m²/);
  const roomMatch = flat.match(/([\d.,]+)\s*Zi\.?/i);
  return {
    rooms: roomMatch ? parseGermanNumber(roomMatch[1]) : null,
    sqm: sqmMatch ? parseGermanNumber(sqmMatch[1]) : null,
  };
}

function unescapeJson(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.parse(`"${raw.replace(/(?<!\\)"/g, '\\"')}"`) as string;
  } catch {
    return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
}

export function parseFetchedPage(page: FetchedPage, config: AdapterConfig = {}): DiscoveredListing[] {
  return kleinanzeigenAdapter.parse(page, config);
}

export type { DiscoveryQuery };
