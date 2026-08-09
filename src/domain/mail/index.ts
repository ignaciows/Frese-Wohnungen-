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
}

export interface ParsedAlert {
  /** Portal key, matched from the listing URLs (not the sender — senders vary). */
  sourceKey: string | null;
  candidateReference: string | null;
  listings: ExtractedListing[];
}

/**
 * Recognised listing URL shapes, in priority order. Only portals whose public
 * expose URLs are stable enough to identify a listing are listed here.
 */
const LISTING_PATTERNS: Array<{ sourceKey: string; re: RegExp }> = [
  { sourceKey: 'immoscout24', re: /https?:\/\/[^\s"'<>]*immobilienscout24\.de\/expose\/\d+[^\s"'<>]*/gi },
  { sourceKey: 'immowelt', re: /https?:\/\/[^\s"'<>]*immowelt\.de\/expose\/[a-z0-9-]+[^\s"'<>]*/gi },
  { sourceKey: 'kleinanzeigen', re: /https?:\/\/[^\s"'<>]*kleinanzeigen\.de\/s-anzeige\/[^\s"'<>]+/gi },
  { sourceKey: 'wg-gesucht', re: /https?:\/\/[^\s"'<>]*wg-gesucht\.de\/[^\s"'<>]*\.\d+\.html[^\s"'<>]*/gi },
  { sourceKey: 'wunderflats', re: /https?:\/\/[^\s"'<>]*wunderflats\.com\/[^\s"'<>]*listing[^\s"'<>]*/gi },
  { sourceKey: 'housinganywhere', re: /https?:\/\/[^\s"'<>]*housinganywhere\.com\/[^\s"'<>]*room[^\s"'<>]*/gi },
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
  const seen = new Set<string>();
  const listings: ExtractedListing[] = [];
  let sourceKey: string | null = null;

  for (const { sourceKey: key, re } of LISTING_PATTERNS) {
    const matches = body.match(re);
    if (!matches || matches.length === 0) continue;
    sourceKey ??= key;
    for (const raw of matches) {
      const url = stripTracking(raw.replace(/&amp;/g, '&').replace(/[.,)\]]+$/, ''));
      if (seen.has(url)) continue;
      seen.add(url);
      listings.push({ url, title: titleForLink(body, raw) });
    }
  }

  return { sourceKey, listings };
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
