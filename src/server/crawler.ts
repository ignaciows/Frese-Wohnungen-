/**
 * The one place that talks to the outside world on discovery's behalf.
 *
 * Everything that keeps us a well-behaved visitor lives here rather than being
 * re-implemented per adapter:
 *
 *  - **robots.txt is fetched, cached and obeyed.** A path the site disallows is
 *    not requested, and the sweep records that honestly.
 *  - **One request at a time per host, with a gap between them.** A sweep of
 *    twelve sources is twelve slow trickles, not a burst.
 *  - **Hard caps** on body size, redirects, timeouts and requests per sweep.
 *  - **SSRF protection** is inherited from `safeFetch`, because discovery URLs
 *    can be typed in by an admin.
 *
 * The rate limiter is per process. That is the right scope here: the app runs
 * as a single Next.js server, and a limiter that needed coordination across
 * processes would be a distributed lock for a tool used by five people.
 */

import { assertPublicUrl } from '@/lib/safeFetch';
import type { FetchedPage } from '@/domain/discovery/types';

/**
 * Identifies us honestly, including a contact URL, so any site owner who
 * objects can find us in their logs and get in touch.
 */
export const CRAWLER_USER_AGENT =
  process.env.DISCOVERY_USER_AGENT?.trim() ||
  'FreseWohnungBot/1.0 (internes Wohnungssuche-Werkzeug; Kontakt: siehe Impressum des Betreibers)';

const DEFAULT_PER_HOST_DELAY_MS = 4000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;

/**
 * Wording that appears on a challenge page and essentially nowhere else.
 *
 * The bar is deliberately high. An earlier version also matched a bare
 * "captcha", which turned out to appear inside WG-Gesucht's cookie-consent
 * configuration (`cmp_block_ignoredomains: ["recaptcha.net", …]`) on a page
 * carrying 28 perfectly good adverts — so a working source was being marked
 * blocked and dropped from every sweep. A false "blocked" is expensive and
 * invisible: the source just quietly stops producing.
 */
const STRONG_BLOCK_MARKERS = [
  'sind sie ein mensch',
  'are you a human',
  'access denied',
  'zugriff verweigert',
  'cf-browser-verification',
  'just a moment...',
  'checking your browser before accessing',
  'attention required! | cloudflare',
  'please enable javascript and cookies to continue',
];

/**
 * Weaker hints. On their own they mean nothing — real pages discuss captchas,
 * rate limits and bots — so they only count on a page too small to be content.
 */
const WEAK_BLOCK_MARKERS = ['captcha', 'bot detection', 'unusual traffic', 'rate limit'];

/**
 * A challenge page is small. Anything past this is a real document, whatever
 * words happen to appear in its scripts.
 */
const BLOCK_PAGE_MAX_BYTES = 50_000;

export interface CrawlerOptions {
  perHostDelayMs?: number;
  timeoutMs?: number;
  /** Upper bound on requests this crawler instance will make in total. */
  maxRequests?: number;
  /** Set false only for a host that has no robots.txt semantics (a raw feed). */
  respectRobots?: boolean;
}

interface RobotsRules {
  /** Disallowed path prefixes that apply to us. */
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
  fetchedAt: number;
}

const robotsCache = new Map<string, RobotsRules>();
const ROBOTS_TTL_MS = 6 * 3_600_000;

/**
 * A crawler instance is created per sweep, so its budget and its per-host
 * timers are naturally scoped to that sweep.
 */
export class Crawler {
  private readonly perHostDelayMs: number;
  private readonly timeoutMs: number;
  private readonly respectRobots: boolean;
  private remaining: number;
  /** Promise chain per host — the simplest correct way to serialise requests. */
  private hostQueue = new Map<string, Promise<unknown>>();
  private lastHitAt = new Map<string, number>();

  readonly stats = { requests: 0, blocked: 0, robotsDenied: 0, errors: 0 };

  constructor(options: CrawlerOptions = {}) {
    this.perHostDelayMs = options.perHostDelayMs ?? DEFAULT_PER_HOST_DELAY_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.respectRobots = options.respectRobots ?? true;
    this.remaining = options.maxRequests ?? 120;
  }

  get budgetLeft(): number {
    return this.remaining;
  }

  /**
   * Fetches a page, queued behind any other request to the same host.
   * Never throws: every failure comes back as a `FetchedPage` with `error` set,
   * because one dead source must not abort a twelve-source sweep.
   */
  async fetchPage(rawUrl: string): Promise<FetchedPage> {
    if (this.remaining <= 0) {
      return page(rawUrl, { error: 'Anfrage-Budget für diesen Lauf aufgebraucht' });
    }

    let host: string;
    try {
      host = new URL(rawUrl).host;
    } catch {
      return page(rawUrl, { error: 'Ungültige URL' });
    }

    const previous = this.hostQueue.get(host) ?? Promise.resolve();
    const next = previous.then(() => this.fetchNow(rawUrl, host));
    // Keep the chain alive even when a link in it rejected.
    this.hostQueue.set(
      host,
      next.catch(() => undefined),
    );
    return next;
  }

  private async fetchNow(rawUrl: string, host: string): Promise<FetchedPage> {
    if (this.remaining <= 0) {
      return page(rawUrl, { error: 'Anfrage-Budget für diesen Lauf aufgebraucht' });
    }

    if (this.respectRobots) {
      const verdict = await this.checkRobots(rawUrl);
      if (!verdict.allowed) {
        this.stats.robotsDenied++;
        return page(rawUrl, { error: 'robots.txt untersagt diesen Pfad', robotsDenied: true });
      }
      if (verdict.crawlDelayMs != null) {
        await this.waitForHost(host, verdict.crawlDelayMs);
      } else {
        await this.waitForHost(host, this.perHostDelayMs);
      }
    } else {
      await this.waitForHost(host, this.perHostDelayMs);
    }

    this.remaining--;
    this.stats.requests++;
    const result = await this.rawFetch(rawUrl);
    if (result.error) this.stats.errors++;
    if (result.blocked) this.stats.blocked++;
    return result;
  }

  private async waitForHost(host: string, delayMs: number): Promise<void> {
    const last = this.lastHitAt.get(host);
    if (last != null) {
      const wait = delayMs - (Date.now() - last);
      if (wait > 0) await sleep(wait);
    }
    this.lastHitAt.set(host, Date.now());
  }

  /** GET with manual redirect handling so every hop is SSRF-checked. */
  private async rawFetch(rawUrl: string): Promise<FetchedPage> {
    let current = rawUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let url: URL;
      try {
        url = await assertPublicUrl(current);
      } catch (err) {
        return page(rawUrl, { error: (err as Error).message });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': CRAWLER_USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
            'accept-language': 'de-DE,de;q=0.9,en;q=0.6',
          },
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) {
            return page(rawUrl, { status: res.status, finalUrl: url.toString() });
          }
          current = new URL(location, url).toString();
          continue;
        }

        const body = await readCapped(res);
        const blocked =
          res.status === 401 ||
          res.status === 403 ||
          res.status === 429 ||
          (body != null && isBlockPage(body));

        return page(rawUrl, {
          status: res.status,
          finalUrl: url.toString(),
          body,
          blocked,
          error: blocked ? blockReason(res.status) : null,
        });
      } catch (err) {
        const message =
          (err as Error).name === 'AbortError' ? 'Zeitüberschreitung' : (err as Error).message;
        return page(rawUrl, { error: message.slice(0, 200) });
      } finally {
        clearTimeout(timer);
      }
    }

    return page(rawUrl, { error: 'Zu viele Weiterleitungen' });
  }

  /** Fetches (and caches) robots.txt, then checks the path against it. */
  private async checkRobots(rawUrl: string): Promise<{ allowed: boolean; crawlDelayMs: number | null }> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { allowed: false, crawlDelayMs: null };
    }

    const origin = url.origin;
    const cached = robotsCache.get(origin);
    const fresh = cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS;

    let rules: RobotsRules;
    if (fresh && cached) {
      rules = cached;
    } else {
      // Fetching robots.txt itself must not be throttled by its own rules.
      await this.waitForHost(url.host, this.perHostDelayMs);
      const res = await this.rawFetch(`${origin}/robots.txt`);
      // No robots.txt, or an unreadable one, means no restrictions — that is
      // what the standard says, and pretending otherwise would disable
      // perfectly permitted sources.
      rules =
        res.status === 200 && res.body
          ? parseRobots(res.body)
          : { disallow: [], allow: [], crawlDelayMs: null, fetchedAt: Date.now() };
      robotsCache.set(origin, rules);
    }

    return {
      allowed: isAllowed(url.pathname + url.search, rules),
      crawlDelayMs: rules.crawlDelayMs,
    };
  }
}

/* ------------------------------------------------------------- robots --- */

/**
 * Parses the groups that apply to us: our own token, then `*`. A site that
 * names us specifically wins over the wildcard, which is what the standard
 * requires.
 */
export function parseRobots(body: string): RobotsRules {
  const ourToken = 'fresewohnungbot';
  const groups = new Map<string, { disallow: string[]; allow: string[]; crawlDelay: number | null }>();
  let currentAgents: string[] = [];
  let sawDirective = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawField, ...rest] = line.split(':');
    const field = rawField.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (field === 'user-agent') {
      // A new user-agent line after directives starts a fresh group.
      if (sawDirective) {
        currentAgents = [];
        sawDirective = false;
      }
      currentAgents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) {
        groups.set(value.toLowerCase(), { disallow: [], allow: [], crawlDelay: null });
      }
      continue;
    }

    if (currentAgents.length === 0) continue;
    sawDirective = true;

    for (const agent of currentAgents) {
      const group = groups.get(agent);
      if (!group) continue;
      if (field === 'disallow' && value) group.disallow.push(value);
      else if (field === 'disallow' && !value) group.disallow.length = 0; // "Disallow:" = allow all
      else if (field === 'allow' && value) group.allow.push(value);
      else if (field === 'crawl-delay') {
        const seconds = Number(value.replace(',', '.'));
        if (Number.isFinite(seconds) && seconds > 0) group.crawlDelay = seconds;
      }
    }
  }

  const chosen =
    [...groups.entries()].find(([agent]) => agent.includes(ourToken))?.[1] ?? groups.get('*') ?? null;

  return {
    disallow: chosen?.disallow ?? [],
    allow: chosen?.allow ?? [],
    // Cap the honoured delay: a site asking for 300 s would stall a sweep
    // entirely, and we would rather skip that source than hang.
    crawlDelayMs:
      chosen?.crawlDelay != null ? Math.min(30_000, Math.round(chosen.crawlDelay * 1000)) : null,
    fetchedAt: Date.now(),
  };
}

/** Longest-match wins, `Allow` beats `Disallow` on a tie — per the standard. */
export function isAllowed(path: string, rules: Pick<RobotsRules, 'allow' | 'disallow'>): boolean {
  const longest = (patterns: string[]) =>
    patterns.reduce((best, pattern) => (matchesRobotsPattern(path, pattern) ? Math.max(best, pattern.length) : best), -1);

  const deny = longest(rules.disallow);
  if (deny < 0) return true;
  return longest(rules.allow) >= deny;
}

/** Supports the two wildcards robots.txt defines: `*` and a trailing `$`. */
function matchesRobotsPattern(path: string, pattern: string): boolean {
  if (!pattern) return false;
  if (!pattern.includes('*') && !pattern.endsWith('$')) return path.startsWith(pattern);

  const anchoredEnd = pattern.endsWith('$');
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}${anchoredEnd ? '$' : ''}`).test(path);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ helpers --- */

function page(url: string, over: Partial<FetchedPage> & { robotsDenied?: boolean } = {}): FetchedPage {
  return {
    url,
    finalUrl: over.finalUrl ?? null,
    status: over.status ?? null,
    body: over.body ?? null,
    error: over.error ?? null,
    blocked: over.blocked ?? false,
  };
}

function blockReason(status: number): string {
  if (status === 429) return 'Portal drosselt Anfragen (HTTP 429)';
  if (status === 401) return 'Portal verlangt Anmeldung (HTTP 401)';
  if (status === 403) return 'Portal blockiert automatische Abrufe (HTTP 403)';
  return 'Portal blockiert automatische Abrufe';
}

export function isBlockPage(body: string): boolean {
  const head = body.slice(0, 4000).toLowerCase();
  if (STRONG_BLOCK_MARKERS.some((marker) => head.includes(marker))) return true;
  // Weak hints only count when the response is too small to be a real page.
  if (body.length > BLOCK_PAGE_MAX_BYTES) return false;
  return WEAK_BLOCK_MARKERS.some((marker) => head.includes(marker));
}

async function readCapped(res: Response): Promise<string | null> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => undefined);

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(merged);
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
