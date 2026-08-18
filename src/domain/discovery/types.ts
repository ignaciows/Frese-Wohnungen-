/**
 * Automatic discovery: asking a source for its *own* current result list,
 * instead of waiting for a colleague to paste links in one at a time.
 *
 * Two rules shape every adapter here:
 *
 *  1. **Split building the URL from parsing the answer.** An adapter never
 *     fetches. It says which URLs it wants (`buildUrls`) and how to read the
 *     response (`parse`). Fetching, robots.txt, rate limiting and error
 *     handling live in one place — and every adapter stays testable against a
 *     saved fixture with no network at all.
 *
 *  2. **Missing data is null, never invented.** A result list that does not
 *     show the Warmmiete yields `null`, and the existing parser decides what
 *     the ad actually costs. An adapter that guesses would poison ranking.
 */

import type { StructuredHints } from '@/domain/parser';

/** What we are looking for, in source-independent terms. */
export interface DiscoveryQuery {
  /** Town the search is centred on, e.g. "Heilbronn". */
  city: string | null;
  postalCode: string | null;
  radiusKm: number | null;
  /** Upper bound in cents. Adapters usually map this to the portal's Kaltmiete filter. */
  maxRentCents: number | null;
  minRooms: number | null;
  minLivingSpaceSqm: number | null;
  /** Include WG rooms and temporary stays (Monteurzimmer, Boardinghäuser). */
  includeTemporary: boolean;
  /** How many result pages an adapter may walk. Keeps a sweep bounded. */
  maxPages: number;
}

export const DEFAULT_QUERY: DiscoveryQuery = {
  city: null,
  postalCode: null,
  radiusKm: 25,
  maxRentCents: null,
  minRooms: null,
  minLivingSpaceSqm: null,
  includeTemporary: false,
  maxPages: 2,
};

/**
 * One ad as it appears in a source's result list. This is raw input for the
 * existing parser — not a Listing.
 */
export interface DiscoveredListing {
  /** Absolute URL of the ad's detail page. */
  url: string;
  title: string;
  /** Whatever text the list view exposed. Often a teaser; that is fine. */
  description: string;
  locationRaw?: string;
  locationCity?: string | null;
  locationPostal?: string | null;
  imageUrl?: string | null;
  /** Structured values read straight from the markup, handed to the parser. */
  structured?: StructuredHints;
  /**
   * How to reach the landlord without going through the portal's form. Only
   * ever what the ad itself published; see domain/contact for how it is read
   * and why a phone number is worth this much trouble.
   */
  contactEmail?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  /** Portal-side enquiry form, when the list view links one. */
  contactFormUrl?: string | null;
  /**
   * When the source's own result list says the ad went online.
   *
   * Worth carrying separately from the detail-page reader in
   * `domain/liveness/postedAt`: several sources state the date right in the
   * list, so taking it here gives every ad a date immediately instead of only
   * the handful that get a detail fetch each sweep.
   */
  postedAt?: { at: Date; label: string } | null;
}

/** Result of one HTTP call made on an adapter's behalf. */
export interface FetchedPage {
  url: string;
  finalUrl: string | null;
  status: number | null;
  body: string | null;
  /** Set when the request could not be completed at all. */
  error: string | null;
  /** True when the response looks like an anti-bot wall rather than content. */
  blocked: boolean;
}

/**
 * Free-form per-source configuration, edited by an admin in the settings.
 * Adapters validate what they need and ignore the rest, so adding a site is a
 * database change rather than a deploy.
 */
export type AdapterConfig = Record<string, unknown>;

export interface DiscoveryAdapter {
  key: string;
  label: string;
  /** One sentence for the settings screen. */
  description: string;
  /**
   * Which config keys this adapter reads. Shown in the UI so an admin knows
   * what to fill in, and used to flag a source that can never work.
   */
  configKeys: Array<{ key: string; required: boolean; hint: string }>;
  /**
   * Optional lookup step for values that only the source can supply — most
   * often its internal id for a town, which its search URLs require.
   *
   * Returns config additions, which the orchestrator caches per (source, city)
   * so the lookup costs one request a day rather than one per sweep. Returning
   * null means "this query cannot be served"; the sweep is then skipped
   * honestly instead of running unfiltered.
   */
  prepare?(
    query: DiscoveryQuery,
    config: AdapterConfig,
    fetchPage: (url: string) => Promise<FetchedPage>,
  ): Promise<AdapterConfig | null>;
  /**
   * URLs to fetch for this query, most promising first. Returning an empty
   * array means "this adapter cannot serve this query" — not an error.
   */
  buildUrls(query: DiscoveryQuery, config: AdapterConfig): string[];
  /** Read one fetched page into ads. Must never throw on malformed input. */
  parse(page: FetchedPage, config: AdapterConfig): DiscoveredListing[];
}

/* ------------------------------------------------------------ helpers --- */

export function cfgString(config: AdapterConfig, key: string): string | null {
  const v = config[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function cfgNumber(config: AdapterConfig, key: string): number | null {
  const v = config[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function cfgStringList(config: AdapterConfig, key: string): string[] {
  const v = config[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && !!x.trim());
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Fills `{city}`, `{plz}`, `{radius}`, `{maxRent}`, `{minRooms}`, `{minSqm}`
 * and `{page}` in a configured URL template.
 *
 * Values are URL-encoded. A template referencing a placeholder we have no value
 * for returns null rather than a URL with a literal "{city}" in it — a request
 * that would either 404 or, worse, silently return nationwide results.
 */
export function fillTemplate(
  template: string,
  query: DiscoveryQuery,
  page: number,
): string | null {
  const values: Record<string, string | null> = {
    city: query.city,
    citySlug: query.city ? slugify(query.city) : null,
    plz: query.postalCode,
    radius: query.radiusKm != null ? String(query.radiusKm) : null,
    maxRent: query.maxRentCents != null ? String(Math.round(query.maxRentCents / 100)) : null,
    minRooms: query.minRooms != null ? String(query.minRooms) : null,
    minSqm: query.minLivingSpaceSqm != null ? String(Math.round(query.minLivingSpaceSqm)) : null,
    page: String(page),
  };

  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = values[name];
    if (value == null) {
      missing = true;
      return '';
    }
    return encodeURIComponent(value);
  });

  return missing ? null : out;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
