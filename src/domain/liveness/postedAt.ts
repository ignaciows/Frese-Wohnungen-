/**
 * "When was this ad put up?" — read from the ad itself.
 *
 * The date we import an ad is not the date it was published. An ad that
 * arrived in this morning's search-agent mail can already be three weeks old,
 * and three-week-old flats are usually gone. Until now every freshness badge
 * was computed from `importedAt`, which measures *our* activity rather than the
 * market's, so a stale ad looked brand new the day we found it.
 *
 * Portals do publish the real date, in prose rather than in a header:
 * "Online seit dem 04.08.2026", "Eingestellt am 4. August 2026", "Online seit
 * 2 Tagen", or a `datePosted` in their schema.org block. This module reads it.
 *
 * Everything is pure and takes `now` explicitly, so relative dates ("seit 3
 * Tagen") are testable.
 */

import { textOf } from '@/domain/discovery/html';

export interface PostedAtResult {
  /** When the ad says it went online. Null when the page does not say. */
  at: Date | null;
  /** Ready-to-show German label, e.g. "Online seit 04.08.2026". */
  label: string | null;
  /** PUBLISHED beats UPDATED: a bump is not a birth date. */
  kind: 'PUBLISHED' | 'UPDATED' | null;
  ageDays: number | null;
  /** Which pattern found it, for the audit trail. */
  evidence: string | null;
}

export const NO_POSTED_AT: PostedAtResult = {
  at: null,
  label: null,
  kind: null,
  ageDays: null,
  evidence: null,
};

const MONTHS: Record<string, number> = {
  januar: 0, jan: 0, jänner: 0,
  februar: 1, feb: 1,
  märz: 2, maerz: 2, mrz: 2, mar: 2,
  april: 3, apr: 3,
  mai: 4,
  juni: 5, jun: 5,
  juli: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9,
  november: 10, nov: 10,
  dezember: 11, dez: 11,
};

/**
 * How far back a date may lie and still be believable as a publication date.
 *
 * Ad pages are full of other years — Baujahr 1968, an Impressum from 2019, a
 * copyright footer. Anything outside this window is one of those, not the ad's
 * own date, so it is discarded rather than shown.
 */
const MAX_AGE_DAYS = 400;
/** Small tolerance so a timezone difference never rejects today's date. */
const MAX_FUTURE_DAYS = 2;

function utcDate(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month, day));
  // Rejects 31 February and friends, which roll over silently otherwise.
  if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  return d;
}

/** Two-digit years are this century; portals never mean 1926. */
function fullYear(raw: string): number {
  const n = Number(raw);
  if (raw.length <= 2) return 2000 + n;
  return n;
}

/**
 * Reads the first date-looking thing out of a short window of text.
 * Returns null rather than guessing when nothing matches cleanly.
 */
export function parseDateish(window: string): Date | null {
  // ISO first — it is unambiguous, and schema.org uses it.
  const iso = window.match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (iso) {
    const base = utcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (base && iso[4]) {
      base.setUTCHours(Number(iso[4]), Number(iso[5]));
    }
    if (base) return base;
  }

  // 04.08.2026 / 4.8.26
  const dotted = window.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/);
  if (dotted) {
    const d = utcDate(fullYear(dotted[3]), Number(dotted[2]) - 1, Number(dotted[1]));
    if (d) return d;
  }

  // 4. August 2026 / 4 Aug 2026
  const named = window.match(/(\d{1,2})\.?\s+([A-Za-zÄÖÜäöüß]{3,10})\.?\s+(\d{4})/);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month != null) {
      const d = utcDate(Number(named[3]), month, Number(named[1]));
      if (d) return d;
    }
  }

  return null;
}

const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  minuten: 60_000,
  min: 60_000,
  stunde: 3_600_000,
  stunden: 3_600_000,
  std: 3_600_000,
  tag: 86_400_000,
  tagen: 86_400_000,
  tage: 86_400_000,
  woche: 604_800_000,
  wochen: 604_800_000,
  monat: 2_592_000_000,
  monaten: 2_592_000_000,
  hour: 3_600_000,
  hours: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

/** "heute", "gestern", "2 Tagen", "3 hours ago" — relative to `now`. */
export function parseRelative(window: string, now: Date): Date | null {
  const w = window.toLowerCase();

  // "Heute" means some time today, not this instant. Anchoring it to the start
  // of the day errs towards older, which is the only safe direction here:
  // Kleinanzeigen labels everything posted today "Heute", and reading that as
  // "just now" made 18 ads in a live sweep all claim to be two minutes old.
  // Understating freshness costs a little urgency; overstating it sends
  // somebody chasing a nine-hour-old advert believing they are first.
  if (/^\W{0,3}(heute|today)\b/.test(w)) return startOfUtcDay(now);
  if (/^\W{0,3}(gestern|yesterday)\b/.test(w)) {
    return new Date(startOfUtcDay(now).getTime() - 86_400_000);
  }

  const rel = w.match(/^\W{0,3}(?:vor\s+)?(\d{1,3})\s*([a-zä]+)/);
  if (rel) {
    const unit = UNIT_MS[rel[2]];
    if (unit) {
      const n = Number(rel[1]);
      // A guard against reading a house number or a price as an age.
      if (n >= 0 && n <= 400) return new Date(now.getTime() - n * unit);
    }
  }
  return null;
}

/**
 * Wordings that introduce the date, in priority order.
 *
 * PUBLISHED cues come first so "Online seit … · Aktualisiert am …" reports the
 * publication date rather than the bump — an ad bumped today can still be a
 * month old, and the bump is exactly the thing that hides that.
 */
const CUES: Array<{ re: RegExp; kind: PostedAtResult['kind']; verb: string }> = [
  { re: /online\s+seit(?:\s+dem)?\s*:?/gi, kind: 'PUBLISHED', verb: 'Online seit' },
  { re: /eingestellt\s+(?:am|seit)\s*:?/gi, kind: 'PUBLISHED', verb: 'Eingestellt am' },
  { re: /inseriert\s+(?:am|seit)\s*:?/gi, kind: 'PUBLISHED', verb: 'Inseriert am' },
  { re: /veröffentlicht\s+am\s*:?/gi, kind: 'PUBLISHED', verb: 'Veröffentlicht am' },
  { re: /veroeffentlicht\s+am\s*:?/gi, kind: 'PUBLISHED', verb: 'Veröffentlicht am' },
  { re: /erstellt\s+am\s*:?/gi, kind: 'PUBLISHED', verb: 'Erstellt am' },
  { re: /anzeige\s+vom\s*:?/gi, kind: 'PUBLISHED', verb: 'Anzeige vom' },
  { re: /(?:inserat|angebot)\s+(?:vom|seit)\s*:?/gi, kind: 'PUBLISHED', verb: 'Inserat vom' },
  { re: /\bposted\s+(?:on\s+)?:?/gi, kind: 'PUBLISHED', verb: 'Online seit' },
  { re: /\blisted\s+(?:on\s+)?:?/gi, kind: 'PUBLISHED', verb: 'Online seit' },
  { re: /aktualisiert\s+(?:am|:)\s*:?/gi, kind: 'UPDATED', verb: 'Aktualisiert am' },
  { re: /zuletzt\s+(?:geändert|geaendert|aktualisiert)\s*(?:am)?\s*:?/gi, kind: 'UPDATED', verb: 'Aktualisiert am' },
  { re: /letzte\s+änderung\s*:?/gi, kind: 'UPDATED', verb: 'Aktualisiert am' },
];

/** schema.org / OpenGraph fields, read straight off the markup. */
const MARKUP_FIELDS: Array<{ re: RegExp; kind: PostedAtResult['kind']; verb: string; evidence: string }> = [
  { re: /"date(?:Posted|Published|Created)"\s*:\s*"([^"]{8,40})"/i, kind: 'PUBLISHED', verb: 'Online seit', evidence: 'schema.org datePosted' },
  { re: /property=["']article:published_time["']\s+content=["']([^"']{8,40})["']/i, kind: 'PUBLISHED', verb: 'Online seit', evidence: 'meta article:published_time' },
  { re: /content=["']([^"']{8,40})["']\s+property=["']article:published_time["']/i, kind: 'PUBLISHED', verb: 'Online seit', evidence: 'meta article:published_time' },
  { re: /"dateModified"\s*:\s*"([^"]{8,40})"/i, kind: 'UPDATED', verb: 'Aktualisiert am', evidence: 'schema.org dateModified' },
  { re: /<time[^>]+datetime=["']([^"']{8,40})["']/i, kind: 'PUBLISHED', verb: 'Online seit', evidence: '<time datetime>' },
];

function formatDe(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function ageDaysOf(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
}

function plausible(at: Date, now: Date): boolean {
  const diffDays = (now.getTime() - at.getTime()) / 86_400_000;
  return diffDays >= -MAX_FUTURE_DAYS && diffDays <= MAX_AGE_DAYS;
}

/**
 * The German label shown next to an ad's date.
 *
 * Exported because the date reaches us two ways — read off a detail page here,
 * or taken straight from a source's result list (see
 * `domain/discovery/listPostedAt`) — and both should read identically. One
 * wording, one place.
 */
export function postedAtLabel(at: Date, now: Date = new Date(), verb = 'Online seit'): string {
  const ageDays = ageDaysOf(at, now);
  const human = ageDays === 0 ? 'heute' : ageDays === 1 ? 'gestern' : `vor ${ageDays} Tagen`;
  return `${verb} ${formatDe(at)} (${human})`;
}

function build(at: Date, kind: PostedAtResult['kind'], verb: string, evidence: string, now: Date): PostedAtResult {
  return {
    at,
    kind,
    ageDays: ageDaysOf(at, now),
    label: postedAtLabel(at, now, verb),
    evidence,
  };
}

/**
 * Finds the publication date on a fetched ad page.
 *
 * Prose is searched before markup, because the visible "Online seit" is what a
 * colleague would read, and a portal that shows one date while carrying another
 * in its JSON-LD means the visible one. Markup is the fallback for the many
 * pages that render their date with JavaScript.
 */
export function extractPostedAt(body: string | null, now: Date = new Date()): PostedAtResult {
  if (!body) return NO_POSTED_AT;

  const text = textOf(body);
  const publishedFirst: PostedAtResult[] = [];
  const updatedFallback: PostedAtResult[] = [];

  for (const cue of CUES) {
    cue.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = cue.re.exec(text)) !== null) {
      // A short window: the date follows the cue immediately, and a wide one
      // would happily pick up the next paragraph's Baujahr.
      const window = text.slice(m.index + m[0].length, m.index + m[0].length + 32);
      const at = parseDateish(window) ?? parseRelative(window, now);
      if (!at || !plausible(at, now)) continue;
      const found = build(at, cue.kind, cue.verb, `Seitentext: „${m[0].trim()}"`, now);
      (cue.kind === 'PUBLISHED' ? publishedFirst : updatedFallback).push(found);
      break;
    }
  }

  for (const field of MARKUP_FIELDS) {
    const m = body.match(field.re);
    if (!m) continue;
    const at = parseDateish(m[1]);
    if (!at || !plausible(at, now)) continue;
    const found = build(at, field.kind, field.verb, field.evidence, now);
    (field.kind === 'PUBLISHED' ? publishedFirst : updatedFallback).push(found);
  }

  const pool = publishedFirst.length > 0 ? publishedFirst : updatedFallback;
  if (pool.length === 0) return NO_POSTED_AT;

  // Several dates on one page: take the oldest publication date. A portal that
  // shows both "eingestellt" and "aktualisiert" is telling us the ad is older
  // than the bump suggests, and the older number is the honest one.
  return pool.reduce((oldest, c) => (c.at! < oldest.at! ? c : oldest));
}
