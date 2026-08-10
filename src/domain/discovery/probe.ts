/**
 * "Here is a website — can we read it, and how?"
 *
 * Germany has no central list of rental adverts. The stock is spread over a
 * handful of big portals and then a very long tail: municipal housing
 * companies, cooperatives, regional agents, church and welfare providers,
 * company housing offices. Hand-writing an adapter per site would mean a
 * deploy per site and a maintenance bill nobody pays twice.
 *
 * So instead of more adapters, this probes a site once and works out which of
 * the generic ones already fits: a feed if it publishes one, schema.org if its
 * pages carry it, a sitemap, or a plain link list as the last resort. An admin
 * pastes a URL and gets a ready configuration back.
 *
 * It is deliberately conservative. A guess that "sort of" works produces a
 * source that silently returns nothing, which is worse than an honest "this
 * one needs manual work" — so every candidate carries what it actually found.
 */

import { absoluteUrl, allMatches, flattenJsonLd, jsonLdBlocks, textOf, typesOf } from './html';
import type { FetchedPage } from './types';

export interface ProbeCandidate {
  adapter: 'feed' | 'jsonld' | 'sitemap' | 'linklist';
  config: Record<string, unknown>;
  /** 0..100. How sure we are this will actually produce listings. */
  confidence: number;
  /** What was found, in plain German, for the settings screen. */
  evidence: string;
}

export interface ProbeReport {
  url: string;
  reachable: boolean;
  blocked: boolean;
  robotsAllowed: boolean;
  note: string;
  candidates: ProbeCandidate[];
}

/** URL patterns that look like an individual advert rather than navigation. */
const LISTING_PATH_PATTERNS: Array<{ pattern: RegExp; source: string }> = [
  { pattern: /\/expose\/[^/]+/i, source: '/expose/' },
  { pattern: /\/s-anzeige\//i, source: '/s-anzeige/' },
  { pattern: /\/immobilie[n]?\/[^/]*\d/i, source: '/immobilie' },
  { pattern: /\/wohnung(en)?\/[^/]*\d/i, source: '/wohnung' },
  { pattern: /\/objekt[e]?\/[^/]*\d/i, source: '/objekt' },
  { pattern: /\/angebot[e]?\/[^/]*\d/i, source: '/angebot' },
  { pattern: /\/mietangebot[e]?\//i, source: '/mietangebot' },
  { pattern: /\/detail[s]?\/[^/]*\d/i, source: '/detail' },
  { pattern: /\/listing[s]?\/[^/]*\d/i, source: '/listing' },
  { pattern: /\/property\/[^/]*\d/i, source: '/property' },
  { pattern: /\/exposes?\//i, source: '/expose' },
];

/** Paths worth trying when a site advertises no feed in its markup. */
export const COMMON_FEED_PATHS = [
  '/feed',
  '/rss',
  '/rss.xml',
  '/feed.xml',
  '/atom.xml',
  '/index.xml',
  '/immobilien/feed',
  '/wohnungen/feed',
  '/angebote/feed',
  '/immobilien.rss',
  '/wohnungsangebote/feed',
];

export const COMMON_SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'];

/** Feed URLs a page declares in its own `<link rel="alternate">` tags. */
export function declaredFeeds(page: FetchedPage): string[] {
  if (!page.body) return [];
  const base = page.finalUrl ?? page.url;
  const out: string[] = [];
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(page.body)) !== null) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["'][^"']*(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const abs = absoluteUrl(href, base);
    if (abs && !out.includes(abs)) out.push(abs);
  }
  return out;
}

/** Does this body look like a real feed with entries? */
export function feedItemCount(page: FetchedPage): number {
  if (!page.body) return 0;
  const head = page.body.slice(0, 2000).toLowerCase();
  if (!head.includes('<rss') && !head.includes('<feed') && !head.includes('<rdf')) return 0;
  const items = (page.body.match(/<item[\s>]/gi) ?? []).length;
  const entries = (page.body.match(/<entry[\s>]/gi) ?? []).length;
  return items + entries;
}

/** schema.org nodes on the page that describe something rentable. */
export function jsonLdListingCount(page: FetchedPage): number {
  if (!page.body) return 0;
  const wanted = ['realestatelisting', 'apartment', 'house', 'accommodation', 'residence', 'suite'];
  return flattenJsonLd(jsonLdBlocks(page.body)).filter((node) => {
    const types = typesOf(node);
    if (!types.some((t) => wanted.includes(t))) return false;
    // A bare type with no name or url is decoration, not an advert.
    return typeof node.name === 'string' || typeof node.url === 'string';
  }).length;
}

/**
 * Finds the link shape that repeats most on a list page.
 *
 * A results page links each advert with the same URL structure, so the most
 * frequent listing-ish pattern is almost always the right one. Requiring
 * several matches is what stops a single "Impressum" link from being mistaken
 * for the advert pattern.
 */
export function guessLinkPattern(page: FetchedPage): { pattern: string; count: number } | null {
  if (!page.body) return null;
  const base = page.finalUrl ?? page.url;
  const hrefs = allMatches(page.body, /<a\b[^>]*href="([^"#]+)"/gi)
    .map((href) => absoluteUrl(href, base))
    .filter((u): u is string => !!u);

  // Only same-site links; an advert never lives on someone else's domain.
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    return null;
  }
  const paths = hrefs
    .filter((u) => {
      try {
        return new URL(u).host === host;
      } catch {
        return false;
      }
    })
    .map((u) => new URL(u).pathname);

  let best: { pattern: string; count: number } | null = null;
  for (const { pattern, source } of LISTING_PATH_PATTERNS) {
    const count = new Set(paths.filter((p) => pattern.test(p))).size;
    if (count >= 3 && (!best || count > best.count)) {
      best = { pattern: source.replace(/\//g, '\\/'), count };
    }
  }
  return best;
}

/**
 * Turns the probe's raw findings into ranked configurations.
 *
 * Ordering reflects durability, not convenience: a feed is published for
 * exactly this purpose and survives redesigns, schema.org is maintained for
 * search engines and so is nearly as stable, a sitemap is stable but says
 * nothing about a listing, and a link pattern breaks the next time somebody
 * touches the CSS.
 */
export function buildCandidates(input: {
  searchUrl: string;
  searchPage: FetchedPage | null;
  feedPages: FetchedPage[];
  sitemapPage: FetchedPage | null;
}): ProbeCandidate[] {
  const out: ProbeCandidate[] = [];

  for (const feed of input.feedPages) {
    const count = feedItemCount(feed);
    if (count > 0) {
      out.push({
        adapter: 'feed',
        config: { feedUrl: feed.finalUrl ?? feed.url },
        confidence: 95,
        evidence: `Feed mit ${count} Einträgen gefunden.`,
      });
    }
  }

  if (input.searchPage) {
    const jsonLd = jsonLdListingCount(input.searchPage);
    if (jsonLd >= 2) {
      out.push({
        adapter: 'jsonld',
        config: { searchUrlTemplate: input.searchUrl },
        confidence: 80,
        evidence: `${jsonLd} Anzeigen als strukturierte Daten (schema.org) auf der Seite.`,
      });
    }

    const link = guessLinkPattern(input.searchPage);
    if (link) {
      out.push({
        adapter: 'linklist',
        config: { searchUrlTemplate: input.searchUrl, linkPattern: link.pattern },
        // Never above the structured options: markup changes break this first.
        confidence: Math.min(60, 30 + link.count * 2),
        evidence: `${link.count} Links im Muster „${link.pattern}" — Details kommen von der Anzeigenseite.`,
      });
    }
  }

  if (input.sitemapPage) {
    const locs = allMatches(input.sitemapPage.body ?? '', /<loc>\s*([^<\s]+)\s*<\/loc>/gi);
    const listingish = locs.filter((u) => LISTING_PATH_PATTERNS.some((p) => p.pattern.test(u)));
    if (listingish.length >= 3) {
      const shared = LISTING_PATH_PATTERNS.find((p) => listingish.filter((u) => p.pattern.test(u)).length >= 3);
      out.push({
        adapter: 'sitemap',
        config: {
          sitemapUrl: input.sitemapPage.finalUrl ?? input.sitemapPage.url,
          ...(shared ? { linkPattern: shared.source.replace(/\//g, '\\/') } : {}),
        },
        confidence: 55,
        evidence: `Sitemap mit ${listingish.length} anzeigenartigen Adressen.`,
      });
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

/** One-line summary for the settings screen. */
export function describeReport(report: ProbeReport): string {
  if (!report.robotsAllowed) return 'Die robots.txt dieser Seite untersagt automatische Abrufe dieses Pfads.';
  if (report.blocked) return 'Die Seite blockiert automatische Abrufe. Nur manueller Weg oder E-Mail-Suchauftrag.';
  if (!report.reachable) return `Nicht erreichbar: ${report.note}`;
  if (report.candidates.length === 0) {
    return 'Erreichbar, aber kein verwertbares Muster gefunden — vermutlich lädt die Seite ihre Ergebnisse per JavaScript nach. Manueller Weg.';
  }
  const best = report.candidates[0];
  return `${best.evidence} Vorschlag: ${best.adapter}.`;
}

export function pageText(page: FetchedPage, limit = 400): string {
  return textOf(page.body ?? '').slice(0, limit);
}
