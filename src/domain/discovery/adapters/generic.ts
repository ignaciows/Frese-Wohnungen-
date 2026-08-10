/**
 * Site-agnostic adapters.
 *
 * Hand-written adapters do not scale: Germany has hundreds of municipal
 * housing companies, cooperatives and regional agents, and each one is a few
 * dozen flats. Writing a parser per site would mean a deploy per site and a
 * permanent maintenance bill.
 *
 * These three cover most of them with configuration alone:
 *
 *  - `feed`     — the site publishes RSS/Atom. Cheapest and most reliable.
 *  - `jsonld`   — the site's list page carries schema.org markup, which most
 *                 modern real-estate CMSs emit for Google.
 *  - `linklist` — nothing structured at all: harvest the links that match a
 *                 pattern and let the enrichment step read each detail page.
 *
 * A colleague adds a site by pasting a URL and picking one of the three, so
 * coverage grows without touching this file.
 */

import {
  cfgString,
  cfgStringList,
  fillTemplate,
  type AdapterConfig,
  type DiscoveredListing,
  type DiscoveryAdapter,
  type DiscoveryQuery,
  type FetchedPage,
} from '../types';
import {
  absoluteUrl,
  allMatches,
  decodeEntities,
  firstMatch,
  flattenJsonLd,
  jsonLdBlocks,
  parseGermanNumber,
  parsePriceCents,
  splitByMarker,
  textOf,
  typesOf,
} from '../html';

/* ------------------------------------------------------------- feeds ---- */

export const feedAdapter: DiscoveryAdapter = {
  key: 'feed',
  label: 'RSS-/Atom-Feed',
  description:
    'Liest einen RSS- oder Atom-Feed. Viele kommunale Wohnungsunternehmen und Genossenschaften veröffentlichen ihre freien Wohnungen so — die verlässlichste Quelle überhaupt.',
  configKeys: [
    { key: 'feedUrl', required: true, hint: 'Volle Feed-Adresse, z. B. https://…/wohnungen/feed.xml' },
    {
      key: 'feedUrls',
      required: false,
      hint: 'Mehrere Feeds, einer pro Zeile — nützlich bei einem Feed pro Stadt.',
    },
  ],

  buildUrls(_query, config) {
    const single = cfgString(config, 'feedUrl');
    const many = cfgStringList(config, 'feedUrls');
    return [...new Set([...(single ? [single] : []), ...many])];
  },

  parse(page) {
    if (!page.body) return [];
    const base = page.finalUrl ?? page.url;
    const out: DiscoveredListing[] = [];

    // RSS <item> and Atom <entry> only differ in the tag name and link shape.
    const items = [
      ...splitByMarker(page.body, /<item[\s>]/i).filter((c) => /<\/item>/i.test(c)),
      ...splitByMarker(page.body, /<entry[\s>]/i).filter((c) => /<\/entry>/i.test(c)),
    ];

    for (const item of items) {
      const rawLink =
        firstMatch(item, /<link[^>]*\bhref="([^"]+)"/i) ??
        firstMatch(item, /<link>([\s\S]*?)<\/link>/i) ??
        firstMatch(item, /<guid[^>]*>([\s\S]*?)<\/guid>/i);
      if (!rawLink) continue;
      const url = absoluteUrl(stripCdata(rawLink), base);
      if (!url || !/^https?:/.test(url)) continue;

      const title = stripCdata(firstMatch(item, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? '');
      if (!title) continue;

      const summary = stripCdata(
        firstMatch(item, /<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i) ??
          '',
      );
      const description = textOf(summary);

      out.push({
        url,
        title: textOf(title),
        description,
        // A feed rarely separates price from prose, so the existing German
        // parser does the extraction from the text — the same path a pasted
        // ad takes.
        structured: {},
      });
    }

    return out;
  },
};

function stripCdata(value: string): string {
  return decodeEntities(value.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')).trim();
}

/* ------------------------------------------------------------ json-ld --- */

/** schema.org types that describe something rentable. */
const LISTING_TYPES = [
  'realestatelisting',
  'apartment',
  'house',
  'singlefamilyresidence',
  'accommodation',
  'residence',
  'suite',
  'room',
  'offer',
  'product',
];

export const jsonLdAdapter: DiscoveryAdapter = {
  key: 'jsonld',
  label: 'Strukturierte Daten (schema.org)',
  description:
    'Liest die schema.org-Daten, die viele Immobilien-Websites für Suchmaschinen einbetten. Funktioniert ohne site-spezifischen Code.',
  configKeys: [
    {
      key: 'searchUrlTemplate',
      required: true,
      hint: 'Such-URL mit Platzhaltern: {city} {plz} {radius} {maxRent} {minRooms} {minSqm} {page}. Beispiel: https://…/suche?ort={city}&maxmiete={maxRent}&seite={page}',
    },
    { key: 'pageStart', required: false, hint: 'Erste Seitennummer (Standard 1).' },
  ],

  buildUrls(query, config) {
    const template = cfgString(config, 'searchUrlTemplate');
    if (!template) return [];
    const start = Number(config.pageStart ?? 1);
    const urls: string[] = [];
    for (let i = 0; i < Math.max(1, query.maxPages); i++) {
      const url = fillTemplate(template, query, start + i);
      if (url) urls.push(url);
    }
    return urls;
  },

  parse(page) {
    if (!page.body) return [];
    const base = page.finalUrl ?? page.url;
    const nodes = flattenJsonLd(jsonLdBlocks(page.body));
    const out: DiscoveredListing[] = [];
    const seen = new Set<string>();

    for (const node of nodes) {
      const types = typesOf(node);
      if (!types.some((t) => LISTING_TYPES.includes(t))) continue;

      const href = str(node.url) ?? str(node['@id']) ?? str((node.mainEntityOfPage as Record<string, unknown>)?.['@id']);
      if (!href) continue;
      const url = absoluteUrl(href, base);
      if (!url || !/^https?:/.test(url) || seen.has(url)) continue;

      const title = str(node.name) ?? str(node.headline);
      if (!title) continue;
      // The list page itself carries schema.org markup too; skip self-links.
      if (url.replace(/\/$/, '') === base.replace(/\/$/, '')) continue;

      seen.add(url);
      out.push({
        url,
        title,
        description: str(node.description) ?? '',
        ...addressOf(node),
        imageUrl: imageOf(node, base),
        structured: {
          kaltMieteCents: priceOf(node),
          rooms: numberOf(node, ['numberOfRooms', 'numberOfBedrooms']),
          livingSpaceSqm: areaOf(node),
        },
      });
    }

    return out;
  },
};

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return decodeEntities(value.trim());
  if (typeof value === 'number') return String(value);
  return null;
}

function addressOf(node: Record<string, unknown>): Pick<
  DiscoveredListing,
  'locationRaw' | 'locationCity' | 'locationPostal'
> {
  const address = node.address;
  if (typeof address === 'string') {
    return { locationRaw: address, locationCity: null, locationPostal: null };
  }
  if (address && typeof address === 'object') {
    const a = address as Record<string, unknown>;
    const city = str(a.addressLocality);
    const postal = str(a.postalCode);
    const street = str(a.streetAddress);
    return {
      locationRaw: [street, postal, city].filter(Boolean).join(', '),
      locationCity: city,
      locationPostal: postal,
    };
  }
  return { locationRaw: '', locationCity: null, locationPostal: null };
}

function imageOf(node: Record<string, unknown>, base: string): string | null {
  const image = node.image;
  const raw =
    typeof image === 'string'
      ? image
      : Array.isArray(image) && typeof image[0] === 'string'
        ? (image[0] as string)
        : image && typeof image === 'object'
          ? str((image as Record<string, unknown>).url)
          : null;
  return raw ? absoluteUrl(raw, base) : null;
}

function priceOf(node: Record<string, unknown>): number | null {
  const offers = node.offers ?? node;
  const candidates = Array.isArray(offers) ? offers : [offers];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const o = candidate as Record<string, unknown>;
    const raw = o.price ?? o.lowPrice ?? (o.priceSpecification as Record<string, unknown> | undefined)?.price;
    const cents = typeof raw === 'number' ? Math.round(raw * 100) : parsePriceCents(str(raw));
    if (cents != null) return cents;
  }
  return null;
}

function numberOf(node: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = node[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const v = (raw as Record<string, unknown>).value;
      if (typeof v === 'number') return v;
      const parsed = parseGermanNumber(str(v));
      if (parsed != null) return parsed;
    }
    const parsed = parseGermanNumber(str(raw));
    if (parsed != null) return parsed;
  }
  return null;
}

function areaOf(node: Record<string, unknown>): number | null {
  const area = node.floorSize ?? node.area;
  if (!area) return null;
  if (typeof area === 'number') return area;
  if (typeof area === 'object') {
    const v = (area as Record<string, unknown>).value;
    if (typeof v === 'number') return v;
    return parseGermanNumber(str(v));
  }
  return parseGermanNumber(str(area));
}

/* ---------------------------------------------------------- link list --- */

export const linkListAdapter: DiscoveryAdapter = {
  key: 'linklist',
  label: 'Linkliste (ohne strukturierte Daten)',
  description:
    'Sammelt von einer Übersichtsseite alle Links, die zu einem Muster passen. Die Details holt anschließend die Detailprüfung von der jeweiligen Anzeigenseite.',
  configKeys: [
    {
      key: 'searchUrlTemplate',
      required: true,
      hint: 'Übersichtsseite, Platzhalter wie bei schema.org ({city}, {maxRent}, {page}).',
    },
    {
      key: 'linkPattern',
      required: true,
      hint: 'Regulärer Ausdruck für Anzeigen-Links, z. B. /wohnung/\\d+ oder /expose/',
    },
    { key: 'pageStart', required: false, hint: 'Erste Seitennummer (Standard 1).' },
  ],

  buildUrls(query, config) {
    const template = cfgString(config, 'searchUrlTemplate');
    const pattern = cfgString(config, 'linkPattern');
    if (!template || !pattern) return [];
    const start = Number(config.pageStart ?? 1);
    const urls: string[] = [];
    for (let i = 0; i < Math.max(1, query.maxPages); i++) {
      const url = fillTemplate(template, query, start + i);
      if (url) urls.push(url);
    }
    return urls;
  },

  parse(page, config) {
    if (!page.body) return [];
    const patternSource = cfgString(config, 'linkPattern');
    if (!patternSource) return [];

    let pattern: RegExp;
    try {
      pattern = new RegExp(patternSource, 'i');
    } catch {
      // A malformed pattern is a configuration mistake, not a crash.
      return [];
    }

    const base = page.finalUrl ?? page.url;
    const out: DiscoveredListing[] = [];
    const seen = new Set<string>();

    // Capture the anchor's own text so the ad has a usable title before the
    // detail page is read.
    const anchors = page.body.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,400}?)<\/a>/gi);
    for (const match of anchors) {
      const href = decodeEntities(match[1]);
      if (!pattern.test(href)) continue;
      const url = absoluteUrl(href, base);
      if (!url || !/^https?:/.test(url) || seen.has(url)) continue;
      seen.add(url);

      const label = textOf(match[2]).replace(/\s+/g, ' ').trim();
      out.push({
        url,
        // An empty anchor (an image link) still deserves to be followed; the
        // enrichment step replaces this placeholder with the real title.
        title: label || 'Anzeige (Titel folgt bei Detailprüfung)',
        description: '',
        structured: {},
      });
    }

    return out;
  },
};

/* ----------------------------------------------------------- sitemaps --- */

export const sitemapAdapter: DiscoveryAdapter = {
  key: 'sitemap',
  label: 'Sitemap',
  description:
    'Liest die sitemap.xml einer Website und nimmt alle zuletzt geänderten Anzeigen-URLs auf. Gut für Anbieter ohne Suchfunktion.',
  configKeys: [
    { key: 'sitemapUrl', required: true, hint: 'z. B. https://…/sitemap.xml' },
    { key: 'linkPattern', required: false, hint: 'Nur URLs, die zu diesem Muster passen.' },
  ],

  buildUrls(_query, config) {
    const url = cfgString(config, 'sitemapUrl');
    return url ? [url] : [];
  },

  parse(page, config) {
    if (!page.body) return [];
    const patternSource = cfgString(config, 'linkPattern');
    let pattern: RegExp | null = null;
    if (patternSource) {
      try {
        pattern = new RegExp(patternSource, 'i');
      } catch {
        return [];
      }
    }

    const out: DiscoveredListing[] = [];
    for (const loc of allMatches(page.body, /<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      if (pattern && !pattern.test(loc)) continue;
      if (!/^https?:/.test(loc)) continue;
      out.push({
        url: loc,
        title: 'Anzeige (Titel folgt bei Detailprüfung)',
        description: '',
        structured: {},
      });
    }
    return out;
  },
};

/* -------------------------------------------------- detail enrichment --- */

/**
 * Reads a single ad's detail page.
 *
 * Result lists are teasers: they rarely show the Nebenkosten, the availability
 * date or whether a WBS is required — exactly the fields that decide whether an
 * ad is worth a message. This runs against a bounded number of ads per sweep,
 * newest first, so the extra requests stay proportionate.
 */
export function parseDetailPage(page: FetchedPage): Partial<DiscoveredListing> | null {
  if (!page.body) return null;
  const base = page.finalUrl ?? page.url;
  const html = page.body;

  const nodes = flattenJsonLd(jsonLdBlocks(html));
  const listingNode = nodes.find((n) => typesOf(n).some((t) => LISTING_TYPES.includes(t)));

  const title =
    (listingNode ? str(listingNode.name) : null) ??
    firstMatch(html, /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ??
    firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);

  const description =
    (listingNode ? str(listingNode.description) : null) ??
    firstMatch(html, /<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ??
    firstMatch(html, /<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ??
    bodyText(html);

  const result: Partial<DiscoveredListing> = {
    ...(title ? { title: textOf(title).slice(0, 300) } : {}),
    ...(description ? { description: textOf(description).slice(0, 20_000) } : {}),
    contactEmail: findContactEmail(html),
    imageUrl:
      (listingNode ? imageOf(listingNode, base) : null) ??
      firstMatch(html, /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i),
  };

  if (listingNode) {
    result.structured = {
      kaltMieteCents: priceOf(listingNode),
      rooms: numberOf(listingNode, ['numberOfRooms', 'numberOfBedrooms']),
      livingSpaceSqm: areaOf(listingNode),
    };
    Object.assign(result, addressOf(listingNode));
  }

  return result;
}

/** Ads that publish an address get answered by email instead of a portal form. */
function findContactEmail(html: string): string | null {
  const mailto = firstMatch(html, /mailto:([^"'?\s>]+@[^"'?\s>]+)/i);
  if (mailto && isPlausibleEmail(mailto)) return mailto.toLowerCase();

  const inText = textOf(html).match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  if (inText && isPlausibleEmail(inText[0])) return inText[0].toLowerCase();
  return null;
}

/**
 * Filters out the addresses that are never a landlord: image filenames, the
 * portal's own support desk, obvious placeholders.
 */
function isPlausibleEmail(value: string): boolean {
  const email = value.toLowerCase();
  if (!/^[\w.+-]+@[\w-]+\.[\w.-]{2,}$/.test(email)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(email)) return false;
  return !/^(no-?reply|donotreply|support|info@(sentry|google|facebook)|example|test)@|@(example|sentry|google|localhost)\./.test(
    email,
  );
}

function bodyText(html: string): string | null {
  const main =
    firstMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i) ??
    firstMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (!main) return null;
  const text = textOf(main);
  return text.length > 40 ? text : null;
}

export const GENERIC_ADAPTERS = [feedAdapter, jsonLdAdapter, linkListAdapter, sitemapAdapter];
export type { DiscoveryQuery, AdapterConfig };
