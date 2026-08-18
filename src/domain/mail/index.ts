/**
 * Parsing of portal "Suchagent" alert emails.
 *
 * This is the legitimate route to automatic new-listing detection: the
 * colleague creates a saved search on the portal with their own account and
 * points the alert at a shared mailbox. We only read mail that was deliberately
 * sent to us — no scraping, no portal credentials, nothing that breaks a
 * portal's terms.
 *
 * Everything in this file is pure so it can be tested without a mail server.
 */

/** Which candidate an alert belongs to, encoded in the recipient address. */
export interface RecipientRouting {
  /** e.g. "CAND-2026-014" from wohnungen+CAND-2026-014@frese.de */
  candidateReference: string | null;
  mailbox: string;
}

export interface ExtractedListing {
  url: string;
  /** Best-effort title: link text, or the surrounding heading. */
  title: string | null;
  /**
   * The mail's own text about this advert — the block between its link and the
   * next one, tags stripped.
   *
   * This matters more than it looks. ImmoScout24 and Immowelt refuse to be read
   * automatically, so for those two the alert mail is the *only* text we will
   * ever have about the flat. It carries the Kaltmiete, the size, the room
   * count and the district, which is most of what the ranking needs. Handing it
   * to the ordinary listing parser turns a bare link into a usable row.
   */
  teaser: string;
}

export interface ParsedAlert {
  /** Portal key, matched from the listing URLs (not the sender — senders vary). */
  sourceKey: string | null;
  candidateReference: string | null;
  listings: ExtractedListing[];
}

/**
 * The URL shapes that identify one advert on each of the three portals.
 *
 * Immonet links are matched onto the Immowelt key on purpose: the two merged,
 * and their mails still carry either host.
 */
const LISTING_PATTERNS: Array<{ sourceKey: string; re: RegExp }> = [
  { sourceKey: 'immoscout24', re: /https?:\/\/[^\s"'<>]*immobilienscout24\.de\/expose\/\d+[^\s"'<>]*/gi },
  { sourceKey: 'immowelt', re: /https?:\/\/[^\s"'<>]*immowelt\.de\/expose\/[a-z0-9-]+[^\s"'<>]*/gi },
  { sourceKey: 'immowelt', re: /https?:\/\/[^\s"'<>]*immonet\.de\/[^\s"'<>]*\d{6,}[^\s"'<>]*/gi },
  { sourceKey: 'kleinanzeigen', re: /https?:\/\/[^\s"'<>]*kleinanzeigen\.de\/s-anzeige\/[^\s"'<>]+/gi },
];

/**
 * Reads the candidate reference out of a plus-addressed recipient.
 * `wohnungen+CAND-2026-014@frese.de` -> "CAND-2026-014".
 */
export function parseRecipient(address: string): RecipientRouting {
  const clean = address.trim().toLowerCase();
  const at = clean.indexOf('@');
  if (at < 0) return { candidateReference: null, mailbox: clean };
  const local = clean.slice(0, at);
  const plus = local.indexOf('+');
  if (plus < 0) return { candidateReference: null, mailbox: local };
  const tag = local.slice(plus + 1).trim();
  return { candidateReference: tag ? tag.toUpperCase() : null, mailbox: local.slice(0, plus) };
}

/** Picks the candidate reference from any of the recipient headers. */
export function routeFromRecipients(addresses: string[]): string | null {
  for (const a of addresses) {
    const r = parseRecipient(a);
    if (r.candidateReference) return r.candidateReference;
  }
  return null;
}

function stripTracking(url: string): string {
  // Alert mails wrap links in redirect/tracking params; keep the identity part.
  return url.replace(/[?&](utm_[^=&]+|wt_[^=&]+|cid|mc_[^=&]+)=[^&]*/gi, '').replace(/[?&]$/, '');
}

/**
 * Extracts listing links from an email body. Accepts HTML or plain text; the
 * caller should pass HTML when available because it carries the link text.
 */
export function extractListings(body: string): { sourceKey: string | null; listings: ExtractedListing[] } {
  let sourceKey: string | null = null;

  // Collect every link with where it sat in the mail, so the text belonging to
  // each advert can be cut out afterwards.
  const hits: Array<{ url: string; raw: string; at: number }> = [];
  const seen = new Set<string>();

  for (const { sourceKey: key, re } of LISTING_PATTERNS) {
    for (const match of body.matchAll(re)) {
      sourceKey ??= key;
      const url = stripTracking(match[0].replace(/&amp;/g, '&').replace(/[.,)\]]+$/, ''));
      // The same advert is usually linked twice — once from its photo, once
      // from its headline. The first position is the start of its block.
      if (seen.has(url)) continue;
      seen.add(url);
      hits.push({ url, raw: match[0], at: match.index });
    }
  }

  hits.sort((a, b) => a.at - b.at);

  const listings = hits.map((hit, i) => ({
    url: hit.url,
    title: titleForLink(body, hit.raw),
    teaser: teaserBetween(body, hit.at, hits[i + 1]?.at ?? body.length),
  }));

  return { sourceKey, listings };
}

/** How much text after a link can plausibly still be about that advert. */
const MAX_TEASER_CHARS = 1200;

/**
 * The mail's text about one advert: everything from its link up to the next
 * advert's link, with the markup taken out.
 *
 * Bounded, because the last advert in a mail is followed by the whole footer —
 * imprint, unsubscribe links, legal boilerplate — and none of that is about a
 * flat.
 */
function teaserBetween(body: string, from: number, to: number): string {
  const block = body.slice(from, Math.min(to, from + MAX_TEASER_CHARS * 4));
  return block
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&euro;/g, '€')
    .replace(/&[a-z]+;/gi, ' ')
    // Drop the URL itself: it is not prose, and its digits look like figures
    // to the parser.
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEASER_CHARS);
}

/**
 * Best-effort title: the text of the anchor that wraps this URL. Alert mails
 * put the headline there. Returns null rather than guessing badly.
 */
function titleForLink(body: string, url: string): string | null {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anchor = new RegExp(`<a[^>]+href=["']${escaped}["'][^>]*>([\\s\\S]{0,300}?)</a>`, 'i');
  const m = body.match(anchor);
  if (!m) return null;
  const text = m[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 8 || text.length > 200) return null;
  // Ignore generic call-to-action link text.
  if (/^(hier|mehr|details|ansehen|zum angebot|jetzt ansehen|view|see more)\b/i.test(text)) return null;
  return text;
}

export interface RawEmail {
  messageId: string;
  from: string;
  recipients: string[];
  subject: string;
  html: string | null;
  text: string | null;
  receivedAt: Date;
}

export function parseAlertEmail(mail: RawEmail): ParsedAlert {
  const body = mail.html || mail.text || '';
  const { sourceKey, listings } = extractListings(body);
  return {
    sourceKey,
    candidateReference: routeFromRecipients(mail.recipients),
    listings,
  };
}

/* ----------------------------------------------------- reply detection --- */

export type MailKind = 'ALERT' | 'REPLY' | 'UNKNOWN';

export interface MailClassification {
  kind: MailKind;
  reason: string;
}

/** Wording portals use when telling us about *new search results*. */
const ALERT_SIGNALS = [
  'suchagent',
  'suchauftrag',
  'neue angebote',
  'neue treffer',
  'neue immobilien',
  'neue anzeigen',
  'passende angebote',
  'ihr suchprofil',
  'new listings',
  'new matches',
  'saved search',
];

/** Wording that means a human answered our enquiry. */
const REPLY_SIGNALS = [
  'antwort auf ihre anfrage',
  'ihre anfrage',
  'antwort von',
  'neue nachricht',
  'hat ihnen geantwortet',
  'nachricht erhalten',
  'antwort erhalten',
  're:',
  'aw:',
  'wg:',
  'reply to your',
  'replied to your',
  'new message',
];

/**
 * Decides whether a mail announces new results or answers an enquiry.
 *
 * `knownContactedUrls` are canonical URLs of listings this mailbox has already
 * written to. A mail pointing at exactly one of those, without alert wording,
 * is almost certainly the landlord answering.
 */
export function classifyMail(
  mail: Pick<RawEmail, 'subject' | 'from'> & { body: string },
  listingUrls: string[],
  knownContactedUrls: Set<string>,
): MailClassification {
  const hay = `${mail.subject} ${mail.body}`.toLowerCase();

  const alertHit = ALERT_SIGNALS.find((s) => hay.includes(s));
  const replyHit = REPLY_SIGNALS.find((s) => hay.includes(s));
  const contacted = listingUrls.filter((u) => knownContactedUrls.has(u));

  // Several listings in one mail is the shape of a digest, not a reply.
  if (listingUrls.length > 1 && !replyHit) {
    return { kind: 'ALERT', reason: `${listingUrls.length} Anzeigen — sieht nach Suchagent aus` };
  }

  if (contacted.length === 1) {
    // We wrote to exactly this flat. Explicit alert wording still wins, because
    // a digest can legitimately re-list something we already contacted.
    if (alertHit && !replyHit) {
      return { kind: 'ALERT', reason: `Suchagent-Formulierung erkannt („${alertHit}")` };
    }
    return { kind: 'REPLY', reason: 'Bezieht sich auf eine bereits angeschriebene Anzeige' };
  }

  if (replyHit && listingUrls.length <= 1) {
    return { kind: 'REPLY', reason: `Antwort-Formulierung erkannt („${replyHit}")` };
  }
  if (alertHit) return { kind: 'ALERT', reason: `Suchagent-Formulierung erkannt („${alertHit}")` };
  if (listingUrls.length > 0) return { kind: 'ALERT', reason: 'Anzeigen-Links ohne Antwort-Hinweis' };

  return { kind: 'UNKNOWN', reason: 'Weder Anzeigen-Links noch eindeutige Formulierung' };
}

/**
 * Strips quoted history and signatures so a logged reply reads as what the
 * landlord actually wrote, not a wall of our own message quoted back.
 */
export function extractReplyText(body: string, maxLength = 4000): string {
  let text = body;

  // Drop HTML tags if we were handed a rendered mail.
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = text
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
  }

  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  const cutMarkers = [
    /^\s*-{2,}\s*ursprüngliche nachricht\s*-{2,}/im,
    /^\s*-{2,}\s*original message\s*-{2,}/im,
    /^\s*am .{5,60} schrieb .{2,80}:\s*$/im,
    /^\s*on .{5,60} wrote:\s*$/im,
    /^\s*von:\s*.+$/im,
    /^\s*_{5,}\s*$/m,
  ];
  for (const re of cutMarkers) {
    const m = text.match(re);
    // Only cut when real content precedes the marker — otherwise a mail that
    // opens with the quote would be reduced to nothing.
    if (m && m.index != null && text.slice(0, m.index).trim().length >= 10) {
      text = text.slice(0, m.index);
    }
  }

  // Drop quoted lines.
  text = text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');

  return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim().slice(0, maxLength);
}
