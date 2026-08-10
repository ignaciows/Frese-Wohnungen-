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
 * *more* ads rather than fewer. Because the autocomplete is off limits, the
 * town's internal id is configuration: an admin pastes one search URL from
 * their browser and the id is read out of it. Guessing ids was never an
 * option — a wrong one silently returns a different town's flats.
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
/** 203 = Mietwohnungen, 199 = WG-Zimmer, 201 = Temporäres Wohnen. */
const CATEGORY_FLATS = 'c203';
const CATEGORY_WG = 'c199';
const CATEGORY_TEMPORARY = 'c201';
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
      required: true,
      hint: 'Ortsnummern, eine pro Zeile. Aus einer Such-URL ablesen: bei …/c203l9228 ist 9228 die Nummer. Mehrere Orte ersetzen den (gesperrten) Umkreisfilter.',
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

  buildUrls(query, config) {
    const locationIds = resolveLocationIds(config);
    if (locationIds.length === 0) return [];

    const categories = query.includeTemporary
      ? [CATEGORY_FLATS, CATEGORY_WG, CATEGORY_TEMPORARY]
      : config.includeWgRooms === true
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
