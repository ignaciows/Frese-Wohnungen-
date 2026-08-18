/**
 * Deciding whether a listing we already know about is still online — by
 * reading the page, not by trusting its status code.
 *
 * The status code is nearly useless here. German portals almost never answer
 * 404 for a withdrawn ad: ImmoScout24 serves "Angebot nicht gefunden" as a
 * perfectly healthy 200, Kleinanzeigen renders a deleted ad as a 200 with a
 * notice on it, WG-Gesucht redirects into its search with a 200 at the end.
 * Waiting for a 404 means telling a colleague an ad is fine right up until
 * they open it and read that it is gone. So the page *text* is the primary
 * evidence and the status code is only one more signal alongside it.
 *
 * Because reading text is inherently uncertain, the answer is a percentage
 * rather than a yes/no: `onlineConfidence` is how likely the ad is to still be
 * live. Ads in the middle are neither shown as fine nor hidden — they are
 * marked "zu prüfen", because a detector that silently buries a good flat on a
 * guess is worse than one that admits it does not know.
 *
 * The rule that outranks everything else: **never report GONE when we simply
 * could not tell.** Blocked, throttled and broken responses resolve to BLOCKED
 * or UNKNOWN and can never retire an ad.
 */

import { extractPostedAt, NO_POSTED_AT, type PostedAtResult } from './postedAt';

export type { PostedAtResult } from './postedAt';
export { extractPostedAt } from './postedAt';

export type LivenessVerdict = 'ALIVE' | 'GONE' | 'BLOCKED' | 'UNKNOWN';

export interface LivenessInput {
  requestedUrl: string;
  /** URL after redirects, if the client followed any. */
  finalUrl: string | null;
  status: number | null;
  /** The page body. The more of it we get, the better the reading. */
  bodySnippet: string | null;
  /** Set when the request never completed (timeout, DNS, TLS…). */
  networkError?: string | null;
  /** Injected in tests so relative dates ("seit 2 Tagen") are deterministic. */
  now?: Date;
}

/** One observation and how much it moves the verdict. */
export interface LivenessSignal {
  side: 'ALIVE' | 'GONE' | 'BLOCKED';
  /** 0..1 — how strongly this single observation implies its side. */
  weight: number;
  /** German, shown to the user so the percentage is explainable. */
  label: string;
}

export interface LivenessResult {
  verdict: LivenessVerdict;
  /**
   * 0..100 — the probability that the ad is still online. This is the number
   * the UI shows ("noch online: 70 %"); the verdict is just a band of it.
   */
  onlineConfidence: number;
  /** 0..100 — how sure we are of the verdict itself. */
  confidence: number;
  reason: string;
  /** What the reading was based on. Ordered strongest first. */
  signals: LivenessSignal[];
  /** When the ad says it went online, if it says so at all. */
  posted: PostedAtResult;
  /** True when this result may count towards auto-expiring the listing. */
  countsTowardsExpiry: boolean;
}

/* ------------------------------------------------------- "it is gone" --- */

/**
 * Phrases German portals use when an ad has been taken down, weighted by how
 * much they can be trusted on their own.
 *
 * DECISIVE wordings cannot occur on a live ad — no landlord writes "Angebot
 * nicht gefunden" into a description. STRONG wordings are unambiguous but
 * could in principle appear inside prose. GENERIC ones are ordinary 404
 * furniture that also shows up in navigation and footers, so on their own they
 * are only a lean, not a verdict.
 */
const DECISIVE_GONE = [
  // --- ImmoScout24 -------------------------------------------------------
  'angebot nicht gefunden',
  'anzeige bereits gelöscht',
  'anzeige bereits geloescht',
  'wurde die anzeige bereits gelöscht',
  'scout-id ist etwas schiefgegangen',
  'dieses angebot wurde deaktiviert',
  // --- Immowelt / Immonet ------------------------------------------------
  'objekt nicht gefunden',
  'immobilie nicht gefunden',
  'exposé nicht gefunden',
  'expose nicht gefunden',
  'exposé ist nicht mehr verfügbar',
  'dieses angebot ist leider nicht mehr',
  // --- Kleinanzeigen -----------------------------------------------------
  'anzeige ist nicht mehr verfügbar',
  'anzeige wurde gelöscht',
  'anzeige wurde geloescht',
  'diese anzeige existiert nicht',
  'anzeige ist leider nicht mehr verfügbar',
  // --- other German portals ----------------------------------------------
  'angebot wurde gelöscht',
  'angebot wurde geloescht',
  'dieses inserat ist nicht mehr',
  'inserat wurde beendet',
  'inserat ist deaktiviert',
  'anzeige ist deaktiviert',
  // --- English portals ---------------------------------------------------
  'this listing is no longer available',
  'listing has been removed',
  'this advert has ended',
  'this property has been let',
];

const STRONG_GONE = [
  'ist nicht mehr verfügbar',
  'nicht mehr verfuegbar',
  'nicht mehr verfügbar',
  'wurde deaktiviert',
  'wurde bereits vermietet',
  'bereits vermietet',
  'inzwischen vermietet',
  'diese anzeige ist nicht mehr',
  'das angebot ist nicht mehr',
  'angebot wurde zurückgezogen',
  'angebot wurde zurueckgezogen',
  'objekt ist nicht mehr verfügbar',
  'objekt wurde vermietet',
  'leider vergeben',
  'bereits vergeben',
  'schon vergeben',
  'vermietung abgeschlossen',
  'no longer available',
  'no longer listed',
  'listing not found',
  'property is not available',
  'already rented',
];

/**
 * Generic 404 furniture — and it only counts as evidence when it is the page's
 * *headline*.
 *
 * In the body it means nothing: portals ship hidden error templates, JS error
 * strings and navigation fallbacks containing "Seite nicht gefunden" on pages
 * that are perfectly alive. Counting those buried strings dragged complete,
 * dated ads down into the uncertain band for no reason. In the `<title>` or the
 * `<h1>`, by contrast, it is the page telling us what it is.
 */
const GENERIC_GONE = [
  'seite nicht gefunden',
  'seite existiert nicht',
  'fehler 404',
  'page not found',
  '404 not found',
];

const WEIGHT_DECISIVE = 0.93;
const WEIGHT_STRONG = 0.8;
const WEIGHT_GENERIC = 0.5;
/** A gone phrase in the title or the H1 is the page's headline, not a footer. */
const HEADLINE_BONUS = 0.06;

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
  'ungewöhnliche aktivität',
  'just a moment',
  'checking your browser',
];

/**
 * Statuses that mean "we were not allowed to read this", never "it is gone".
 *
 * 401 is here because of ImmoScout24: it answers a plain GET from anything that
 * is not a browser with 401 and no auth challenge. Read as an ordinary status
 * that would be an unhelpful shrug; read as what it is, it lets the UI say the
 * honest thing — this portal does not let us check, open it yourself.
 */
const BLOCKED_STATUSES = new Set([401, 403, 407, 429, 451]);

/**
 * A bot wall is a tiny interstitial. A quarter-megabyte page that also renders
 * a complete ad is not one, however often the word "captcha" appears in its
 * scripts, CSS classes or hidden login form — which is exactly what a bare
 * substring search over a real WG-Gesucht page finds. So outside the headline,
 * this wording is only believed on a page small enough to *be* an interstitial.
 */
const BOT_WALL_MAX_BYTES = 20_000;

/* ------------------------------------------------------ "it is alive" --- */

/**
 * Wording that only a live ad page carries. None of these is conclusive by
 * itself — a "gone" page still shows similar flats underneath the notice — so
 * they carry far less weight than the gone wordings above. Their job is to
 * lift a page we could otherwise say nothing about out of the middle band.
 */
const DETAIL_FIELDS = [
  'kaltmiete',
  'warmmiete',
  'nebenkosten',
  'wohnfläche',
  'wohnflaeche',
  'kaution',
  'zimmer',
  'etage',
  'bezugsfrei',
  'wohnungstyp',
  'baujahr',
  'stellplatz',
  'heizkosten',
  'hausgeld',
  'grundmiete',
  'quadratmeter',
];

const CONTACT_AFFORDANCE = [
  'nachricht schreiben',
  'anbieter kontaktieren',
  'kontakt aufnehmen',
  'zur anfrage',
  'anfrage senden',
  'besichtigung anfragen',
  'jetzt anfragen',
  'contact the advertiser',
  'send a message',
];

const LISTING_MARKUP = /"@type"\s*:\s*"(realestatelisting|apartment|house|accommodation|residence|singlefamilyresidence|offer)"/i;
const AVAILABLE_MARKUP = /"availability"\s*:\s*"[^"]*(instock|inStock|available)/i;
const PRICE_TEXT = /(\d{2,3}(?:[.\s]\d{3})*|\d{3,5})\s*(?:€|eur\b)/i;

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

/**
 * The page as a reader sees it: scripts, styles and every tag's attributes
 * removed.
 *
 * A withdrawal notice is something the portal *shows*. Anything that only
 * exists inside markup — a `data-` label held ready for a state the ad is not
 * in, a translation string in a bundled script, a hidden error template — is
 * not the portal saying anything, and treating it as such condemns live ads.
 */
function visibleTextOf(body: string): string {
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** The `<title>` and the first `<h1>`, where a portal puts its verdict. */
function headlineOf(body: string): string {
  const title = body.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ?? '';
  const h1 = body.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i)?.[1] ?? '';
  return `${title} ${h1}`.replace(/<[^>]+>/g, ' ').toLowerCase();
}

/**
 * Combines independent observations that all point the same way.
 *
 * Noisy-OR rather than a sum: two weak hints should reinforce each other
 * without ever adding up past certainty, and a fourth hint should matter less
 * than the first.
 */
function noisyOr(weights: number[]): number {
  return 1 - weights.reduce((acc, w) => acc * (1 - Math.min(0.99, Math.max(0, w))), 1);
}

/* --------------------------------------------------------- the reading --- */

function collectSignals(input: LivenessInput): LivenessSignal[] {
  const signals: LivenessSignal[] = [];
  const raw = input.bodySnippet ?? '';
  const body = raw.toLowerCase();
  // The withdrawal wording is read from what a person would actually see, not
  // from the markup. Every live Kleinanzeigen advert carries the attribute
  // `data-soldlabel="Nicht mehr verfügbar"` on its own headline — the label the
  // page would show *if* the flat were ever let. Matched against raw HTML that
  // is a strong "gone" signal on every single advert, so the biggest source in
  // the system had its entire pool judged dead and filtered out of the results.
  const visible = visibleTextOf(raw);
  const headline = raw ? headlineOf(raw) : '';
  const status = input.status;

  // --- stopped, not gone ---------------------------------------------------
  if (status != null && BLOCKED_STATUSES.has(status)) {
    signals.push({
      side: 'BLOCKED',
      weight: 0.95,
      label:
        status === 429
          ? 'Portal drosselt Anfragen (HTTP 429)'
          : `Portal lässt automatische Abrufe nicht zu (HTTP ${status})`,
    });
  }
  const interstitial = raw.length <= BOT_WALL_MAX_BYTES;
  const blockedPhrase = BLOCKED_PHRASES.find(
    (p) => headline.includes(p) || (interstitial && body.includes(p)),
  );
  if (blockedPhrase) {
    signals.push({ side: 'BLOCKED', weight: 0.9, label: `Bot-Schutz erkannt („${blockedPhrase}")` });
  }

  // --- the ad says it is gone ---------------------------------------------
  const addGone = (phrases: string[], weight: number, kind: string, headlineOnly = false) => {
    for (const p of phrases) {
      const inHeadline = headline.includes(p);
      if (headlineOnly ? !inHeadline : !visible.includes(p)) continue;
      signals.push({
        side: 'GONE',
        weight: Math.min(0.97, weight + (inHeadline ? HEADLINE_BONUS : 0)),
        label: inHeadline ? `Überschrift der Seite: „${p}"` : `${kind}: „${p}"`,
      });
      // One hit per tier is enough; portals repeat the same notice in several
      // places and counting each one would fake certainty.
      return;
    }
  };
  addGone(DECISIVE_GONE, WEIGHT_DECISIVE, 'Seite meldet');
  addGone(STRONG_GONE, WEIGHT_STRONG, 'Seite meldet');
  addGone(GENERIC_GONE, WEIGHT_GENERIC, 'Allgemeiner Fehlertext', true);

  // --- the status code, as one signal among several ------------------------
  if (status === 404 || status === 410) {
    signals.push({ side: 'GONE', weight: 0.85, label: `Server antwortet HTTP ${status}` });
  }

  // Soft 404: the portal answers 200 but bounced us to a search or home page.
  if (
    input.finalUrl &&
    looksLikeListingPath(input.requestedUrl) &&
    !looksLikeListingPath(input.finalUrl)
  ) {
    signals.push({
      side: 'GONE',
      weight: 0.75,
      label: 'Weiterleitung auf Suche/Startseite statt auf die Anzeige',
    });
  }

  // --- the ad still looks like an ad ---------------------------------------
  if (status === 200 || status === 203) {
    const fields = DETAIL_FIELDS.filter((f) => body.includes(f));
    if (fields.length >= 3) {
      signals.push({
        side: 'ALIVE',
        weight: 0.35,
        label: `Anzeigendaten vorhanden (${fields.slice(0, 3).join(', ')})`,
      });
    }
    if (PRICE_TEXT.test(raw)) {
      signals.push({ side: 'ALIVE', weight: 0.35, label: 'Preis steht auf der Seite' });
    }
    if (LISTING_MARKUP.test(raw)) {
      signals.push({
        side: 'ALIVE',
        weight: AVAILABLE_MARKUP.test(raw) ? 0.55 : 0.45,
        label: AVAILABLE_MARKUP.test(raw)
          ? 'Strukturierte Daten melden das Objekt als verfügbar'
          : 'Objekt als strukturierte Daten (schema.org) ausgezeichnet',
      });
    }
    const affordance = CONTACT_AFFORDANCE.find((c) => body.includes(c));
    if (affordance) {
      signals.push({ side: 'ALIVE', weight: 0.35, label: `Kontaktmöglichkeit vorhanden („${affordance}")` });
    }
    if (looksLikeListingPath(input.finalUrl ?? input.requestedUrl)) {
      signals.push({ side: 'ALIVE', weight: 0.25, label: 'Anzeigenseite antwortet normal (HTTP 200)' });
    }
  }

  return signals;
}

/**
 * The heart of it: read the page, weigh what was found, return a percentage.
 *
 * `online = (1 − gone) × (0.5 + 0.5 × alive)` — deliberately asymmetric. A page
 * that explicitly says the ad is withdrawn *is* withdrawn no matter how much
 * else it shows, because a gone page on every big portal still renders similar
 * flats, prices and contact buttons below the notice. The absence of that
 * wording, by contrast, is only weak evidence of life, so alive signals cannot
 * push past what the gone evidence allows — they only lift a page we know
 * nothing bad about from "no idea" (50 %) towards "looks live".
 */
export function evaluateLiveness(
  input: LivenessInput,
  policy: LivenessPolicy = DEFAULT_LIVENESS,
): LivenessResult {
  const now = input.now ?? new Date();

  // Nothing came back at all, so nothing can be read. 50 % is the honest
  // answer, and it must never count towards retiring the ad.
  if (input.networkError) {
    return {
      verdict: 'UNKNOWN',
      onlineConfidence: 50,
      confidence: 0,
      reason: `Nicht erreichbar (${input.networkError}) — Status unklar`,
      signals: [],
      posted: NO_POSTED_AT,
      countsTowardsExpiry: false,
    };
  }

  const posted = extractPostedAt(input.bodySnippet, now);
  const signals = collectSignals(input);

  // A date the ad prints about itself is strong evidence the page still is the
  // ad: withdrawal notices do not carry an "Online seit" line.
  if (posted.at) {
    signals.push({
      side: 'ALIVE',
      weight: posted.kind === 'PUBLISHED' ? 0.5 : 0.4,
      label: posted.label ?? 'Anzeige nennt ein Datum',
    });
  }
  const sorted = sortSignals(signals);

  const blocked = sorted.filter((s) => s.side === 'BLOCKED');
  if (blocked.length > 0) {
    return {
      verdict: 'BLOCKED',
      // Nothing was learned about the ad, so the honest answer is "no idea".
      onlineConfidence: 50,
      confidence: Math.round(noisyOr(blocked.map((s) => s.weight)) * 100),
      reason: `${blocked[0].label} — die Anzeige selbst konnte nicht gelesen werden`,
      signals: sorted,
      posted,
      countsTowardsExpiry: false,
    };
  }

  if (input.status != null && input.status >= 500) {
    return {
      verdict: 'UNKNOWN',
      onlineConfidence: 50,
      confidence: 0,
      reason: `Serverfehler beim Portal (HTTP ${input.status}) — Status unklar`,
      signals: sorted,
      posted,
      countsTowardsExpiry: false,
    };
  }

  const pGone = noisyOr(sorted.filter((s) => s.side === 'GONE').map((s) => s.weight));
  const pAlive = noisyOr(sorted.filter((s) => s.side === 'ALIVE').map((s) => s.weight));
  const onlineConfidence = Math.round(
    Math.min(100, Math.max(0, (1 - pGone) * (0.5 + 0.5 * pAlive) * 100)),
  );

  const top = sorted.slice(0, 2).map((s) => s.label);

  if (onlineConfidence <= policy.goneAtOrBelow) {
    return {
      verdict: 'GONE',
      onlineConfidence,
      confidence: 100 - onlineConfidence,
      reason: top.length > 0 ? top.join(' · ') : 'Keine Hinweise auf eine aktive Anzeige',
      signals: sorted,
      posted,
      countsTowardsExpiry: true,
    };
  }

  if (onlineConfidence >= policy.aliveAtOrAbove) {
    return {
      verdict: 'ALIVE',
      onlineConfidence,
      confidence: onlineConfidence,
      reason: top.length > 0 ? top.join(' · ') : 'Anzeige erreichbar',
      signals: sorted,
      posted,
      countsTowardsExpiry: false,
    };
  }

  // The middle band — "limbo". Shown, flagged, never silently retired.
  return {
    verdict: 'UNKNOWN',
    onlineConfidence,
    confidence: Math.round(Math.abs(onlineConfidence - 50) * 2),
    reason:
      (top.length > 0 ? `${top.join(' · ')} — ` : '') +
      `nicht eindeutig: ${onlineConfidence} % dafür, dass die Anzeige noch online ist`,
    signals: sorted,
    posted,
    countsTowardsExpiry: false,
  };
}

function sortSignals(signals: LivenessSignal[]): LivenessSignal[] {
  return [...signals].sort((a, b) => b.weight - a.weight);
}

/* ------------------------------------------------------------- policy --- */

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
  /** At or above this online-percentage the ad counts as confirmed active. */
  aliveAtOrAbove: number;
  /** At or below it the ad counts as gone. Between the two is "zu prüfen". */
  goneAtOrBelow: number;
  /**
   * Hide the middle band from the working lists. Off by default: the detector
   * reads text and can be wrong, and a hidden flat is a flat nobody ever finds
   * out about. On, for anyone who would rather see only confirmed ads.
   */
  showOnlyConfirmedActive: boolean;
  /**
   * Re-check the ads on screen whenever someone opens a result list, not just
   * on the slow interval. This is what makes the list true at the moment it is
   * read rather than true twelve hours ago.
   */
  checkOnSearch: boolean;
  /** Ads re-checked per search. Small, so opening a list stays fast. */
  checkOnSearchLimit: number;
  /**
   * How much of each page to read. The withdrawal notice sits at the top, but
   * "Online seit" is often far down, so this is generous by the standards of a
   * link check and still trivial next to loading the page in a browser.
   */
  maxBytesPerPage: number;
}

export const DEFAULT_LIVENESS: LivenessPolicy = {
  enabled: true,
  checkIntervalHours: 12,
  // Two strikes: one odd response should never bury a good flat.
  expireAfterConsecutiveGone: 2,
  maxPerRun: 60,
  perHostDelayMs: 2500,
  aliveAtOrAbove: 70,
  goneAtOrBelow: 25,
  showOnlyConfirmedActive: false,
  checkOnSearch: true,
  checkOnSearchLimit: 8,
  maxBytesPerPage: 250_000,
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

/* ------------------------------------------------------- presentation --- */

export type LivenessBand = 'CONFIRMED' | 'LIMBO' | 'DEAD' | 'UNCHECKED';

/**
 * The three states a colleague actually needs to tell apart, plus "not looked
 * at yet". Derived from the stored percentage so the list and the detail pane
 * can never disagree about what an ad is.
 */
export function bandOf(
  listing: { onlineConfidence: number | null; lastCheckStatus: string | null; expired: boolean },
  policy: LivenessPolicy = DEFAULT_LIVENESS,
): LivenessBand {
  if (listing.expired || listing.lastCheckStatus === 'GONE') return 'DEAD';
  if (listing.onlineConfidence == null) return 'UNCHECKED';
  if (listing.onlineConfidence >= policy.aliveAtOrAbove) return 'CONFIRMED';
  if (listing.onlineConfidence <= policy.goneAtOrBelow) return 'DEAD';
  return 'LIMBO';
}

export function describeBand(band: LivenessBand, confidence: number | null): string {
  switch (band) {
    case 'CONFIRMED':
      return `Aktiv bestätigt (${confidence ?? 100} %)`;
    case 'LIMBO':
      return `Zu prüfen — ${confidence ?? 50} % noch online`;
    case 'DEAD':
      return 'Nicht mehr verfügbar';
    default:
      return 'Noch nicht geprüft';
  }
}

/**
 * How much the reading should move a listing's preference score.
 *
 * A confirmed-live ad keeps its score; an uncertain one is pushed below equally
 * good confirmed ones without being hidden; a freshly posted ad gets a small
 * lift, because on this market being early is most of the job.
 */
export function livenessScoreFactor(
  listing: { onlineConfidence: number | null; postedAt: Date | null; firstSeenAt?: Date | null },
  policy: LivenessPolicy = DEFAULT_LIVENESS,
  now: Date = new Date(),
): number {
  let factor = 1;

  const c = listing.onlineConfidence;
  if (c != null) {
    if (c <= policy.goneAtOrBelow) factor *= 0.2;
    else if (c < policy.aliveAtOrAbove) {
      // Linear across the middle band: 0.8 at the bottom, 1.0 at the top.
      const span = Math.max(1, policy.aliveAtOrAbove - policy.goneAtOrBelow);
      factor *= 0.8 + 0.2 * ((c - policy.goneAtOrBelow) / span);
    }
  }

  factor *= recencyFactor(listing, now);

  return Math.round(factor * 1000) / 1000;
}

/**
 * How much being new is worth.
 *
 * On this market being early is most of the job: a flat advertised this
 * morning is genuinely worth more than an equally suitable one from three
 * weeks ago, because the three-week-old one has had eighty replies. The
 * earlier version of this nudged by a tenth either way, which was too small to
 * reorder anything — a stale flat with a slightly better price still sat above
 * today's. The spread is now wide enough to actually decide the order.
 *
 * When the portal prints no date we fall back to when we first saw the ad, and
 * halve the effect. That date is a lower bound — the ad may be far older — so
 * it is honest evidence of "not newer than", but too weak to bury something on.
 */
function recencyFactor(
  listing: { postedAt: Date | null; firstSeenAt?: Date | null },
  now: Date,
): number {
  const dated = listing.postedAt ?? listing.firstSeenAt ?? null;
  if (!dated) return 1;
  const exact = listing.postedAt != null;

  const ageDays = (now.getTime() - dated.getTime()) / 86_400_000;
  const full =
    ageDays <= 1 ? 1.35
    : ageDays <= 3 ? 1.2
    : ageDays <= 7 ? 1.05
    : ageDays <= 14 ? 0.9
    : ageDays <= 30 ? 0.75
    : 0.6;

  // Half the distance from neutral when the date is only a lower bound.
  return exact ? full : 1 + (full - 1) / 2;
}

/** The recency verdict in words, so the score can explain itself. */
export function describeRecency(
  listing: { postedAt: Date | null; firstSeenAt?: Date | null },
  now: Date = new Date(),
): string | null {
  const f = recencyFactor(listing, now);
  if (f === 1) return null;
  const exact = listing.postedAt != null;
  const how = exact ? 'Inseriert' : 'Bei uns bekannt seit';
  const pct = Math.round(Math.abs(f - 1) * 100);
  return f > 1
    ? `${how}: frisch — ${pct} % Bonus, weil früh dran zu sein hier den Unterschied macht`
    : `${how}: älter — ${pct} % Abzug, ältere Anzeigen sind meist längst vergeben`;
}
