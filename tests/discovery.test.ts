/**
 * Adapter tests run against fixtures captured from the live portals, so a
 * markup change shows up here rather than as a silently empty sweep.
 *
 * The assertions that matter most are the negative ones: an adapter must not
 * invent a price, must not accept a nationwide search, and must not turn a
 * blocked page into "nothing found".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { kleinanzeigenAdapter, extractLocationId, resolveLocationIds } from '@/domain/discovery/adapters/kleinanzeigen';
import { wgGesuchtAdapter, looksLikeWgGesuchtSearchUrl } from '@/domain/discovery/adapters/wggesucht';
import { feedAdapter, jsonLdAdapter, linkListAdapter, sitemapAdapter, parseDetailPage } from '@/domain/discovery/adapters/generic';
import { getAdapter, missingConfig } from '@/domain/discovery/registry';
import { DEFAULT_QUERY, fillTemplate, type FetchedPage } from '@/domain/discovery/types';
import { parseGermanNumber, parsePriceCents, textOf, splitByMarker } from '@/domain/discovery/html';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

function page(body: string, url = 'https://www.kleinanzeigen.de/s-wohnung-mieten/heilbronn/c203l9228'): FetchedPage {
  return { url, finalUrl: url, status: 200, body, error: null, blocked: false };
}

const query = { ...DEFAULT_QUERY, city: 'Heilbronn', postalCode: '74072', maxRentCents: 90000, minRooms: 2 };

/* ------------------------------------------------------------- helpers --- */

describe('html helpers', () => {
  it('reads German numbers without confusing thousands and decimals', () => {
    expect(parseGermanNumber('1.250,50')).toBe(1250.5);
    expect(parseGermanNumber('1.250')).toBe(1250);
    expect(parseGermanNumber('47,15 m²')).toBe(47.15);
    expect(parseGermanNumber('auf Anfrage')).toBeNull();
  });

  it('refuses to turn a missing price into zero', () => {
    expect(parsePriceCents('895 €')).toBe(89500);
    expect(parsePriceCents('1.250,00 EUR')).toBe(125000);
    expect(parsePriceCents('Preis auf Anfrage')).toBeNull();
    expect(parsePriceCents('')).toBeNull();
    // A figure that large is a purchase price or a typo, not a monthly rent.
    expect(parsePriceCents('250.000 €')).toBeNull();
  });

  it('strips markup and decodes entities', () => {
    expect(textOf('<p>64&nbsp;m&sup2; &amp; Balkon</p>')).toBe('64 m² & Balkon');
    expect(textOf('<script>var x = "<b>no</b>";</script><p>Ja</p>')).toBe('Ja');
  });

  it('splits a document into one chunk per entry', () => {
    const chunks = splitByMarker('<i>a</i><x/>one<x/>two', /<x\/>/);
    expect(chunks).toEqual(['<x/>one', '<x/>two']);
  });
});

describe('fillTemplate', () => {
  it('substitutes and encodes the values it has', () => {
    expect(fillTemplate('https://x.de/s?ort={city}&max={maxRent}&p={page}', query, 2)).toBe(
      'https://x.de/s?ort=Heilbronn&max=900&p=2',
    );
  });

  it('returns null rather than a URL with an unfilled placeholder', () => {
    // A literal "{plz}" would either 404 or, worse, search all of Germany.
    expect(fillTemplate('https://x.de/s?plz={plz}', { ...query, postalCode: null }, 1)).toBeNull();
  });
});

/* ------------------------------------------------------- kleinanzeigen --- */

describe('kleinanzeigen adapter', () => {
  it('reads the JSON view into ads, skipping sponsored slots', () => {
    // The fixture holds three result rows, one of which is a paid placement
    // carrying `sponsoredAd` rather than `organicAdPreview`. Those are adverts
    // for something else entirely, not flats, so they must not enter the pool.
    const items = kleinanzeigenAdapter.parse(page(fixture('kleinanzeigen-search.json')), {});
    expect(items.length).toBe(2);

    const first = items[0];
    expect(first.url).toMatch(/^https:\/\/www\.kleinanzeigen\.de\/s-anzeige\//);
    expect(first.title.length).toBeGreaterThan(5);
    expect(first.locationPostal).toMatch(/^\d{5}$/);
    expect(first.locationCity).toBeTruthy();
    expect(first.structured?.livingSpaceSqm).toBeGreaterThan(0);
    expect(first.structured?.rooms).toBeGreaterThan(0);
  });

  it('honours the portal\'s own price label instead of guessing', () => {
    // The fixture says "Kaltmiete", so nothing may land in warmMieteCents —
    // treating a Kaltmiete as a Warmmiete would understate the true cost and
    // push unaffordable flats up the ranking.
    const items = kleinanzeigenAdapter.parse(page(fixture('kleinanzeigen-search.json')), {});
    for (const item of items) {
      expect(item.structured?.warmMieteCents ?? null).toBeNull();
    }
    expect(items.some((i) => (i.structured?.kaltMieteCents ?? 0) > 0)).toBe(true);
  });

  it('falls back to the HTML view when JSON is not served', () => {
    const items = kleinanzeigenAdapter.parse(page(fixture('kleinanzeigen-search.html')), {});
    expect(items.length).toBe(3);
    expect(items[0].locationPostal).toMatch(/^\d{5}$/);
    // "(0.8 km)" is a distance badge, not part of the town name.
    expect(items[0].locationCity).not.toMatch(/km/);
  });

  it('builds only robots-permitted URLs', () => {
    const urls = kleinanzeigenAdapter.buildUrls({ ...query, maxPages: 2 }, { locationIds: ['9228'] });
    expect(urls.length).toBe(2);
    for (const url of urls) {
      // robots.txt disallows each of these on the search path.
      expect(url).not.toMatch(/preis::/);
      expect(url).not.toMatch(/anzeige:angebote/);
      expect(url).not.toMatch(/l\d+r\d+/);
      expect(url).toMatch(/c203l9228$/);
    }
    expect(urls[1]).toContain('seite:2');
  });

  it('produces no URLs without a location, so a sweep can never go nationwide', () => {
    expect(kleinanzeigenAdapter.buildUrls(query, {})).toEqual([]);
    // "0" is the portal's id for all of Germany.
    expect(resolveLocationIds({ locationIds: ['0'] })).toEqual([]);
    expect(kleinanzeigenAdapter.buildUrls(query, { locationIds: ['0'] })).toEqual([]);
  });

  it('digs the location id out of a pasted search URL', () => {
    expect(extractLocationId('https://www.kleinanzeigen.de/s-wohnung-mieten/heilbronn/c203l9228r20')).toBe('9228');
    expect(extractLocationId('https://www.kleinanzeigen.de/s-wohnung-mieten/c203')).toBeNull();
    expect(resolveLocationIds({ searchUrl: 'https://www.kleinanzeigen.de/x/c203l9228' })).toEqual(['9228']);
  });

  it('returns nothing for an empty or broken body instead of throwing', () => {
    expect(kleinanzeigenAdapter.parse(page(''), {})).toEqual([]);
    expect(kleinanzeigenAdapter.parse(page('{"result":'), {})).toEqual([]);
    expect(kleinanzeigenAdapter.parse(page('<html><body>nichts</body></html>'), {})).toEqual([]);
  });
});

/* ---------------------------------------------------------- wg-gesucht --- */

describe('wg-gesucht adapter', () => {
  const wgPage = (body: string) =>
    page(body, 'https://www.wg-gesucht.de/wohnungen-in-Hamburg-Hamburg.55.2.1.0.html');

  it('reads cards into ads with price and size', () => {
    const items = wgGesuchtAdapter.parse(wgPage(fixture('wggesucht-search.html')), {});
    expect(items.length).toBeGreaterThanOrEqual(2);
    const withPrice = items.find((i) => (i.structured?.warmMieteCents ?? 0) > 0);
    expect(withPrice).toBeDefined();
    expect(withPrice!.url).toMatch(/wg-gesucht\.de\/.*\.\d+\.html$/);
    expect(withPrice!.structured?.livingSpaceSqm).toBeGreaterThan(0);
    expect(withPrice!.locationCity).toBeTruthy();
  });

  it('collapses the doubled city name WG-Gesucht prints', () => {
    const items = wgGesuchtAdapter.parse(wgPage(fixture('wggesucht-search.html')), {});
    // The markup says "Hamburg Hamburg" when town and district match.
    expect(items[0].locationCity).not.toMatch(/(\b\w+\b) \1/);
  });

  it('paginates a pasted search URL', () => {
    const urls = wgGesuchtAdapter.buildUrls(
      { ...query, maxPages: 3 },
      { searchUrl: 'https://www.wg-gesucht.de/wohnungen-in-Heilbronn-Heilbronn.171.2.1.0.html' },
    );
    expect(urls).toEqual([
      'https://www.wg-gesucht.de/wohnungen-in-Heilbronn-Heilbronn.171.2.1.0.html',
      'https://www.wg-gesucht.de/wohnungen-in-Heilbronn-Heilbronn.171.2.1.1.html',
      'https://www.wg-gesucht.de/wohnungen-in-Heilbronn-Heilbronn.171.2.1.2.html',
    ]);
  });

  it('stays silent without a configured city, rather than guessing an id', () => {
    expect(wgGesuchtAdapter.buildUrls(query, {})).toEqual([]);
  });

  it('validates a pasted URL', () => {
    expect(looksLikeWgGesuchtSearchUrl('https://www.wg-gesucht.de/wohnungen-in-Heilbronn.171.2.1.0.html')).toBe(true);
    expect(looksLikeWgGesuchtSearchUrl('https://www.wg-gesucht.de/')).toBe(false);
    expect(looksLikeWgGesuchtSearchUrl('nonsense')).toBe(false);
  });
});

/* ------------------------------------------------------------- generic --- */

describe('feed adapter', () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>2-Zimmer-Wohnung, 620 € warm</title>
      <link>https://gwg-example.de/wohnung/17</link>
      <description><![CDATA[Frei ab 01.10.2026, 58 m², WBS erforderlich.]]></description></item>
    <item><title>Ohne Link</title><description>x</description></item>
  </channel></rss>`;

  it('reads RSS items', () => {
    const items = feedAdapter.parse(page(rss, 'https://gwg-example.de/feed.xml'), {});
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://gwg-example.de/wohnung/17');
    expect(items[0].description).toContain('58 m²');
  });

  it('reads Atom entries with href links', () => {
    const atom = `<feed><entry><title>Wohnung A</title><link rel="alternate" href="/w/1"/><summary>Text</summary></entry></feed>`;
    const items = feedAdapter.parse(page(atom, 'https://x.de/atom.xml'), {});
    expect(items[0].url).toBe('https://x.de/w/1');
  });

  it('collects every configured feed URL', () => {
    expect(feedAdapter.buildUrls(query, { feedUrl: 'https://a.de/f', feedUrls: 'https://b.de/f\nhttps://a.de/f' })).toEqual([
      'https://a.de/f',
      'https://b.de/f',
    ]);
  });
});

describe('json-ld adapter', () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
      {"@type":"Apartment","name":"3-Zimmer am Park","url":"/expose/9","description":"Hell",
       "address":{"@type":"PostalAddress","streetAddress":"Parkweg 3","postalCode":"74072","addressLocality":"Heilbronn"},
       "numberOfRooms":3,"floorSize":{"@type":"QuantitativeValue","value":78},
       "offers":{"@type":"Offer","price":"845.00","priceCurrency":"EUR"}}]}</script>
    <script type="application/ld+json">{ this is broken json </script>
  </head><body></body></html>`;

  it('extracts listings and survives a broken sibling block', () => {
    const items = jsonLdAdapter.parse(page(html, 'https://makler.de/suche'), {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      url: 'https://makler.de/expose/9',
      title: '3-Zimmer am Park',
      locationPostal: '74072',
      locationCity: 'Heilbronn',
    });
    expect(items[0].structured).toMatchObject({ kaltMieteCents: 84500, rooms: 3, livingSpaceSqm: 78 });
  });

  it('needs a template before it will fetch anything', () => {
    expect(jsonLdAdapter.buildUrls(query, {})).toEqual([]);
    expect(jsonLdAdapter.buildUrls({ ...query, maxPages: 2 }, { searchUrlTemplate: 'https://m.de/s?o={city}&p={page}' })).toEqual([
      'https://m.de/s?o=Heilbronn&p=1',
      'https://m.de/s?o=Heilbronn&p=2',
    ]);
  });
});

describe('link list adapter', () => {
  const html = `<a href="/immobilie/101-schoene-wohnung">Schöne Wohnung</a>
                <a href="/impressum">Impressum</a>
                <a href="/immobilie/102"><img src="x.jpg"></a>`;

  it('keeps only links matching the configured pattern', () => {
    const items = linkListAdapter.parse(page(html, 'https://stadtbau.de/liste'), {
      linkPattern: '/immobilie/\\d+',
    });
    expect(items.map((i) => i.url)).toEqual([
      'https://stadtbau.de/immobilie/101-schoene-wohnung',
      'https://stadtbau.de/immobilie/102',
    ]);
    expect(items[0].title).toBe('Schöne Wohnung');
    // An image-only link still gets followed; the detail read supplies a title.
    expect(items[1].title).toContain('Detailprüfung');
  });

  it('treats a malformed pattern as configuration error, not a crash', () => {
    expect(linkListAdapter.parse(page(html), { linkPattern: '([' })).toEqual([]);
  });
});

describe('sitemap adapter', () => {
  it('filters sitemap URLs by pattern', () => {
    const xml = `<urlset><url><loc>https://x.de/expose/1</loc></url>
      <url><loc>https://x.de/ueber-uns</loc></url></urlset>`;
    const items = sitemapAdapter.parse(page(xml, 'https://x.de/sitemap.xml'), { linkPattern: '/expose/' });
    expect(items.map((i) => i.url)).toEqual(['https://x.de/expose/1']);
  });
});

describe('detail page enrichment', () => {
  it('prefers structured data and finds a contact address', () => {
    const html = `<html><head>
      <meta property="og:title" content="Helle 2-Zimmer-Wohnung">
      <meta property="og:description" content="Kaltmiete 700 €, Nebenkosten 150 €. Frei ab sofort.">
      </head><body><a href="mailto:vermieter@hausverwaltung-mueller.de">Kontakt</a></body></html>`;
    const detail = parseDetailPage(page(html, 'https://x.de/expose/1'));
    expect(detail?.title).toBe('Helle 2-Zimmer-Wohnung');
    expect(detail?.description).toContain('Nebenkosten');
    expect(detail?.contactEmail).toBe('vermieter@hausverwaltung-mueller.de');
  });

  it('ignores addresses that are never a landlord', () => {
    const html = `<html><body><a href="mailto:noreply@portal.de">x</a></body></html>`;
    expect(parseDetailPage(page(html))?.contactEmail).toBeNull();
  });
});

/* ------------------------------------------------------------ registry --- */

describe('registry', () => {
  it('resolves known adapters and shrugs at unknown ones', () => {
    expect(getAdapter('kleinanzeigen')).toBe(kleinanzeigenAdapter);
    expect(getAdapter('does-not-exist')).toBeNull();
    expect(getAdapter(null)).toBeNull();
  });

  it('names the config a source still needs', () => {
    expect(missingConfig('kleinanzeigen', {})).toEqual(['locationIds']);
    expect(missingConfig('kleinanzeigen', { locationIds: ['9228'] })).toEqual([]);
    expect(missingConfig('linklist', { searchUrlTemplate: 'https://x.de' })).toEqual(['linkPattern']);
    expect(missingConfig(null, {})).toEqual([]);
  });
});
