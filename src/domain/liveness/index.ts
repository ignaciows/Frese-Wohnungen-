/**
 * Deciding whether a listing we already know about is still online.
 *
 * This is a liveness probe, not scraping: one request to a URL a colleague
 * already imported, looking only at the status, the final URL and a short
 * slice of the page to spot "this ad is gone" wording. No search results are
 * harvested, no login is bypassed, nothing is collected that we were not
 * already given.
 *
 * The single most important rule: **never report GONE when we simply could not
 * tell.** A false "expired" hides a good flat, which is worse than showing a
 * stale one. Blocked, throttled and broken responses all resolve to UNKNOWN.
 */

export type LivenessVerdict = 'ALIVE' | 'GONE' | 'BLOCKED' | 'UNKNOWN';

export interface LivenessInput {
  requestedUrl: string;
  /** URL after redirects, if the client followed any. */
  finalUrl: string | null;
  status: number | null;
  /** First few KB of the body, lowercased by the caller is fine either way. */
  bodySnippet: string | null;
  /** Set when the request never completed (timeout, DNS, TLS…). */
  networkError?: string | null;
}

export interface LivenessResult {
  verdict: LivenessVerdict;
  reason: string;
  /** True when this result may count towards auto-expiring the listing. */
  countsTowardsExpiry: boolean;
}

/**
 * Phrases German portals use when an ad has been taken down. Deliberately
 * specific: a generic word like "leider" would produce false positives on
 * perfectly live pages.
 */
const GONE_PHRASES = [
  // --- ImmoScout24 -------------------------------------------------------
  // Served as a normal 200 page, so the wording is the only signal.
  'angebot nicht gefunden',
  'anzeige bereits gelöscht',
  'anzeige bereits geloescht',
  'wurde die anzeige bereits gelöscht',
  'scout-id ist etwas schiefgegangen',
  // --- Immowelt / Immonet ------------------------------------------------
  'objekt nicht gefunden',
  'immobilie nicht gefunden',
  'dieses angebot ist leider nicht mehr',
  'exposé nicht gefunden',
  'expose nicht gefunden',
  // --- Kleinanzeigen -----------------------------------------------------
  'anzeige ist nicht mehr verfügbar',
  'anzeige wurde gelöscht',
  'anzeige wurde geloescht',
  'diese anzeige existiert nicht',
  // --- WG-Gesucht --------------------------------------------------------
  'angebot wurde gelöscht',
  'angebot wurde geloescht',
  'dieses inserat ist nicht mehr',
  'inserat wurde beendet',
  'inserat ist deaktiviert',
  // --- generic German ----------------------------------------------------
  'ist nicht mehr verfügbar',
  'nicht mehr verfuegbar',
  'nicht mehr verfügbar',
  'wurde deaktiviert',
  'wurde bereits vermietet',
  'bereits vermietet',
  'diese anzeige ist nicht mehr',
  'das angebot ist nicht mehr',
  'angebot wurde zurückgezogen',
  'angebot wurde zurueckgezogen',
  'objekt ist nicht mehr verfügbar',
  'objekt wurde vermietet',
  'leider vergeben',
  'bereits vergeben',
  'seite nicht gefunden',
  'seite existiert nicht',
  'fehler 404',
  // --- English (HousingAnywhere, Wunderflats, Spotahome…) -----------------
  'no longer available',
  'no longer listed',
  'listing has been removed',
  'listing not found',
  'this advert has ended',
  'property is not available',
  'already rented',
  'page not found',
];

/**
 * Phrases that mean "we were stopped", not "the ad is gone". Seeing these must
 * never expire a listing.
 */
const BLOCKED_PHRASES = [
  'captcha',
  'sind sie ein mensch',
  'are you a human',
  'access denied',
  'zugriff verweigert',
  'bot detection',
  'unusual traffic',
  'rate limit',
];

/**
 * Path fragments that identify an actual listing *detail* page. Deliberately
 * narrow: a loose hint like "/wohnung" also matches search URLs such as
 * "/Suche/de/wohnung-mieten", which would hide every soft 404.
 */
const LISTING_PATH_HINTS = [
  '/expose/',
  '/s-anzeige/',
  '/listing/',
  '/room/',
  '/objekt/',
  '/immobilie/',
  '/angebot/',
];

function looksLikeListingPath(url: string): boolean {
  const lower = url.toLowerCase();
  return LISTING_PATH_HINTS.some((h) => lower.includes(h));
}

export function evaluateLiveness(input: LivenessInput): LivenessResult {
  if (input.networkError) {
    return {
      verdict: 'UNKNOWN',
      reason: `Nicht erreichbar (${input.networkError})`,
      countsTowardsExpiry: false,
    };
  }

  const status = input.status;
  const body = (input.bodySnippet ?? '').toLowerCase();

  // Anti-bot walls first: they often come back as 403 *or* as a 200 page.
  if (status === 403 || status === 429 || BLOCKED_PHRASES.some((p) => body.includes(p))) {
    return {
      verdict: 'BLOCKED',
      reason:
        status === 429
          ? 'Portal drosselt Anfragen — Status unklar'
          : 'Portal blockiert automatische Abrufe — Status unklar',
      countsTowardsExpiry: false,
    };
  }

  if (status === 404 || status === 410) {
    return { verdict: 'GONE', reason: `Seite existiert nicht mehr (HTTP ${status})`, countsTowardsExpiry: true };
  }

  if (status != null && status >= 500) {
    return { verdict: 'UNKNOWN', reason: `Serverfehler beim Portal (HTTP ${status})`, countsTowardsExpiry: false };
  }

  if (status != null && status >= 300 && status < 400) {
    return { verdict: 'UNKNOWN', reason: `Weiterleitung ohne Ziel (HTTP ${status})`, countsTowardsExpiry: false };
  }

  if (status === 200 || status === 203) {
    // Soft 404: the portal answers 200 but bounced us to a search or home page.
    if (
      input.finalUrl &&
      looksLikeListingPath(input.requestedUrl) &&
      !looksLikeListingPath(input.finalUrl)
    ) {
      return {
        verdict: 'GONE',
        reason: 'Weiterleitung auf Suche/Startseite — Anzeige vermutlich entfernt',
        countsTowardsExpiry: true,
      };
    }

    const phrase = GONE_PHRASES.find((p) => body.includes(p));
    if (phrase) {
      return { verdict: 'GONE', reason: `Seite meldet: „${phrase}"`, countsTowardsExpiry: true };
    }

    return { verdict: 'ALIVE', reason: 'Anzeige erreichbar', countsTowardsExpiry: false };
  }

  return {
    verdict: 'UNKNOWN',
    reason: status != null ? `Unerwarteter Status HTTP ${status}` : 'Keine Antwort',
    countsTowardsExpiry: false,
  };
}

export interface LivenessPolicy {
  enabled: boolean;
  /** How often a listing is re-checked. */
  checkIntervalHours: number;
  /** Consecutive GONE verdicts before the listing is auto-expired. */
  expireAfterConsecutiveGone: number;
  /** Upper bound on listings probed per run, to stay polite. */
  maxPerRun: number;
  /** Delay between requests to the same host, in milliseconds. */
  perHostDelayMs: number;
}

export const DEFAULT_LIVENESS: LivenessPolicy = {
  enabled: true,
  checkIntervalHours: 12,
  // Two strikes: one odd response should never bury a good flat.
  expireAfterConsecutiveGone: 2,
  maxPerRun: 60,
  perHostDelayMs: 2500,
};

/** Should this listing be probed now? */
export function isDueForCheck(
  listing: { lastCheckedAt: Date | null; importedAt: Date; expired: boolean },
  policy: LivenessPolicy,
  now: Date = new Date(),
): boolean {
  if (!policy.enabled) return false;
  // Expired listings are left alone; a human can reactivate them.
  if (listing.expired) return false;
  const last = listing.lastCheckedAt ?? listing.importedAt;
  return now.getTime() - last.getTime() >= policy.checkIntervalHours * 3_600_000;
}

/** Given the new verdict, how many consecutive GONE results do we now have? */
export function nextGoneStreak(current: number, result: LivenessResult): number {
  if (result.verdict === 'GONE') return current + 1;
  // Anything that is not a confident GONE resets the streak — including
  // BLOCKED and UNKNOWN, so a blocked portal can never expire a listing.
  return 0;
}

export function shouldAutoExpire(streak: number, policy: LivenessPolicy): boolean {
  return streak >= policy.expireAfterConsecutiveGone;
}
