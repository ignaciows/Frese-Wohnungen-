/**
 * Small, dependency-free HTML helpers for the discovery adapters.
 *
 * Deliberately not a DOM parser. Portal result lists are enormous (half a
 * megabyte is normal) and we need a handful of fields from each entry, so
 * regex-scoped slicing over a string is both faster and far less memory-hungry
 * than building a tree. The trade-off is accepted knowingly: every helper here
 * is written to fail soft — a pattern that stops matching yields nothing, never
 * a wrong value and never an exception.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  sup2: '²',
  deg: '°',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    // Entity names can contain digits ("&sup2;"), so the character class must
    // allow them — missing that turned "64 m²" into an unparseable "64 m&sup2;".
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Strips tags and collapses whitespace. Script/style content is dropped. */
export function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * Splits a document into the chunks that each contain one result entry.
 *
 * `marker` is a regex matching the opening of an entry (e.g. `<article
 * class="aditem"`). Each chunk runs from one marker to the next, which is
 * enough scoping for "the price inside *this* card".
 */
export function splitByMarker(html: string, marker: RegExp): string[] {
  const flags = marker.flags.includes('g') ? marker.flags : marker.flags + 'g';
  const re = new RegExp(marker.source, flags);
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    starts.push(m.index);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return starts.map((start, i) => html.slice(start, starts[i + 1] ?? html.length));
}

/** First capture group of `pattern`, decoded and trimmed, or null. */
export function firstMatch(html: string, pattern: RegExp): string | null {
  const m = html.match(pattern);
  if (!m) return null;
  const value = m[1] ?? m[0];
  const out = decodeEntities(value).trim();
  return out || null;
}

/** All first-capture-group matches, deduplicated in document order. */
export function allMatches(html: string, pattern: RegExp): string[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const re = new RegExp(pattern.source, flags);
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const value = decodeEntities(m[1] ?? m[0]).trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/** Every `application/ld+json` block, parsed. Malformed blocks are skipped. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // A single broken block must not cost us the rest of the page.
    }
  }
  return out;
}

/**
 * Flattens JSON-LD into individual nodes: top-level arrays, `@graph`
 * containers and nested `itemListElement`/`mainEntity` wrappers all collapse
 * into one list, so callers can just filter by `@type`.
 */
export function flattenJsonLd(nodes: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    const obj = node as Record<string, unknown>;
    out.push(obj);
    for (const key of ['@graph', 'itemListElement', 'mainEntity', 'item', 'about', 'offers']) {
      if (key in obj) walk(obj[key], depth + 1);
    }
  };

  walk(nodes, 0);
  return out;
}

export function typesOf(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  if (typeof t === 'string') return [t.toLowerCase()];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase());
  return [];
}

/** Resolves a possibly-relative href against the page it was found on. */
export function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * German number parsing for values scraped out of markup: "1.250,50" → 1250.5,
 * "62 m²" → 62. Returns null for anything that is not clearly a number, so a
 * label like "auf Anfrage" never becomes 0.
 */
export function parseGermanNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/\s/g, '').match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?|-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let token = m[0];
  if (token.includes(',')) {
    // German: dot groups thousands, comma is the decimal separator.
    token = token.replace(/\./g, '').replace(',', '.');
  } else if (/\.\d{3}$/.test(token)) {
    // "1.250" with no decimals is a thousands group, not 1.25.
    token = token.replace(/\./g, '');
  }
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/** Parses a price string to cents. "715 €", "1.250,00 EUR" → 71500 / 125000. */
export function parsePriceCents(raw: string | null | undefined): number | null {
  if (!raw) return null;
  if (/vb|verhandlungsbasis|auf anfrage|preis auf/i.test(raw) && !/\d/.test(raw)) return null;
  const n = parseGermanNumber(raw);
  if (n == null || n <= 0) return null;
  // Guard against picking up a house number or a size by mistake.
  if (n > 100_000) return null;
  return Math.round(n * 100);
}
