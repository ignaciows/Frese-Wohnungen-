/**
 * WG-Gesucht result-list adapter.
 *
 * WG-Gesucht identifies towns by an internal numeric id ("Hamburg" is 55) and
 * exposes no public lookup for it. Rather than ship a table of guessed ids —
 * a wrong id silently returns a different city's flats, which is far worse
 * than returning nothing — this adapter is configured with either the city id
 * or, easier, the search URL an admin pastes straight out of their browser.
 * Pagination is then derived from that URL.
 */

import {
  cfgNumber,
  cfgString,
  type DiscoveredListing,
  type DiscoveryAdapter,
  type DiscoveryQuery,
} from '../types';
import {
  absoluteUrl,
  firstMatch,
  parseGermanNumber,
  parsePriceCents,
  splitByMarker,
  textOf,
} from '../html';

const BASE = 'https://www.wg-gesucht.de';

/**
 * WG-Gesucht URLs look like
 *   /wohnungen-in-Hamburg-Hamburg.55.2.1.0.html
 * where the trailing segments are `<cityId>.<category>.<rentType>.<page>`.
 */
const URL_SHAPE = /^(.*?)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\.html$/;

export const wgGesuchtAdapter: DiscoveryAdapter = {
  key: 'wggesucht',
  label: 'WG-Gesucht — Ergebnisliste',
  description:
    'Liest die Ergebnisliste von wg-gesucht.de. Einmalig die Such-URL aus dem Browser einfügen — WG-Gesucht hat keine öffentliche Ortssuche, und geratene Ortsnummern würden die falsche Stadt liefern.',
  configKeys: [
    {
      key: 'searchUrl',
      required: true,
      hint: 'Such-URL aus dem Browser, z. B. https://www.wg-gesucht.de/wohnungen-in-Heilbronn-Heilbronn.171.2.1.0.html — Filter dürfen bereits gesetzt sein.',
    },
    {
      key: 'cityId',
      required: false,
      hint: 'Alternative zur Such-URL: nur die Ortsnummer (die erste Zahl vor „.2.1.0.html").',
    },
    {
      key: 'includeWgRooms',
      required: false,
      hint: 'true, wenn auch WG-Zimmer gefunden werden sollen (Standard: nur Wohnungen).',
    },
  ],

  buildUrls(query, config) {
    const configured = cfgString(config, 'searchUrl');
    const cityId = cfgNumber(config, 'cityId');

    let template: string | null = null;
    if (configured) {
      template = configured;
    } else if (cityId != null) {
      const slug = query.city ? encodeURIComponent(query.city) : 'Deutschland';
      template = `${BASE}/wohnungen-in-${slug}.${cityId}.2.1.0.html`;
    }
    if (!template) return [];

    const urls: string[] = [];
    for (let page = 0; page < Math.max(1, query.maxPages); page++) {
      const url = withPage(template, page);
      if (url) urls.push(url);
    }

    // WG-Zimmer live under category 0 rather than 2.
    if (config.includeWgRooms === true || query.includeTemporary) {
      const rooms = withCategory(template, 0);
      if (rooms) urls.push(rooms);
    }

    return urls;
  },

  parse(page) {
    if (!page.body) return [];
    const base = page.finalUrl ?? page.url;
    const out: DiscoveredListing[] = [];

    for (const card of splitByMarker(page.body, /<div\s+id="liste-details-ad-\d+"/)) {
      const href = firstMatch(card, /href="(\/[^"]*\.\d+\.html)"/);
      if (!href) continue;
      const url = absoluteUrl(href, base);
      if (!url) continue;

      const title = firstMatch(card, /<h2[^>]*truncate_title[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
      if (!title) continue;

      // The grey line under the title: "2-Zimmer-Wohnung | Hamburg | Straße".
      const summary = firstMatch(card, /<div class="col-xs-11[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/);
      const summaryText = summary ? textOf(summary).replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim() : '';

      // The middle row holds price, availability window and size, in that order.
      const middle = firstMatch(card, /<div class="row noprint middle[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
      const bolds = middle ? [...middle.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((m) => textOf(m[1])) : [];
      const priceCents = parsePriceCents(bolds.find((b) => /€|eur/i.test(b)) ?? null);
      const sqmText = bolds.find((b) => /m²|m2/i.test(b)) ?? null;

      const rooms = parseRooms(summaryText, title);
      const { city, street } = splitSummary(summaryText);

      out.push({
        url,
        title: textOf(title),
        description: summaryText,
        locationRaw: [city, street].filter(Boolean).join(', '),
        locationCity: city,
        locationPostal: null,
        imageUrl: firstMatch(card, /<img src="(https:\/\/img\.wg-gesucht\.de[^"]+)"/),
        structured: {
          // WG-Gesucht's headline figure is the Gesamtmiete (warm).
          warmMieteCents: priceCents,
          rooms,
          livingSpaceSqm: parseGermanNumber(sqmText),
        },
      });
    }

    return out;
  },
};

function withPage(template: string, page: number): string | null {
  const m = template.match(URL_SHAPE);
  if (!m) return page === 0 ? template : null;
  const [, prefix, city, category, rentType] = m;
  return `${prefix}.${city}.${category}.${rentType}.${page}.html`;
}

function withCategory(template: string, category: number): string | null {
  const m = template.match(URL_SHAPE);
  if (!m) return null;
  const [, prefix, city, , rentType] = m;
  return `${prefix}.${city}.${category}.${rentType}.0.html`;
}

/** "2-Zimmer-Wohnung Wohnungen | Hamburg Hamburg | Hinter der Lieth 34c" */
function splitSummary(summary: string): { city: string | null; street: string | null } {
  const parts = summary
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return { city: null, street: null };
  // The city is repeated ("Hamburg Hamburg") when town and district match.
  const cityPart = parts[1];
  const words = [...new Set(cityPart.split(/\s+/).filter(Boolean))];
  return {
    city: words.join(' ') || null,
    street: parts[2] ?? null,
  };
}

function parseRooms(summary: string, title: string): number | null {
  for (const text of [summary, title]) {
    const m = text.match(/(\d+(?:[.,]\d+)?)\s*-?\s*Zimmer/i);
    if (m) return parseGermanNumber(m[1]);
  }
  return null;
}

/** Exposed so the settings screen can validate a pasted URL before saving. */
export function looksLikeWgGesuchtSearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.endsWith('wg-gesucht.de') && URL_SHAPE.test(url.pathname);
  } catch {
    return false;
  }
}

export type { DiscoveryQuery };
