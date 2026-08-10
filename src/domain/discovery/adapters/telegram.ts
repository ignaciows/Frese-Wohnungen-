/**
 * Telegram channels.
 *
 * A real share of the German rental market — especially furnished flats,
 * sublets and the international/expat corner — never reaches a portal. It is
 * posted to a Telegram channel and taken within hours. Those posts are exactly
 * the ones a candidate would otherwise never see.
 *
 * **No account, no API key, no credentials.** Telegram publishes every *public*
 * channel as an ordinary web page at `t.me/s/<name>`, server-rendered, for
 * anyone. That is what this reads. Nothing is joined, nothing is logged into,
 * no private group is touched, and no message is sent.
 *
 * The limits are worth stating plainly, because they decide what this can and
 * cannot deliver:
 *
 *  - **Public channels only.** Private groups and invite-only chats are not
 *    readable this way, and would need a real Telegram account plus MTProto
 *    credentials — a separate decision with its own risks.
 *  - **Free text.** A channel post has no price field and no location field.
 *    Everything comes from the existing German parser, so a post written
 *    carelessly yields a thin listing. That is honest: thin is not wrong.
 *  - **Offers and requests look alike.** Half of what gets posted is people
 *    *looking* for a flat. Those are filtered out here — importing them would
 *    fill the pool with other house-hunters.
 */

import {
  cfgStringList,
  type DiscoveredListing,
  type DiscoveryAdapter,
  type FetchedPage,
} from '../types';
import { decodeEntities, firstMatch, splitByMarker, textOf } from '../html';
import { listPostedAt } from '../listPostedAt';

const BASE = 'https://t.me';

/**
 * Wording that marks a post as somebody *seeking* a flat rather than offering
 * one. Deliberately anchored near the start of the text: an offer often ends
 * with "wir suchen einen Nachmieter", which is still an offer.
 */
const SEEKING_PATTERNS = [
  /^\s*(?:#?\w+\s+)?(?:ich\s+)?suche\b/i,
  /^\s*(?:#?\w+\s+)?(?:wir\s+)?suchen\b/i,
  /^\s*#?(?:gesuch|wohnungsgesuch|suche)\b/i,
  /^\s*(?:looking for|searching for|in search of)\b/i,
  /^\s*(?:i am|i'm|we are|we're)\s+looking\b/i,
];

/** A post has to look like a flat at all before it is worth importing. */
const OFFER_HINTS = [
  /\bzimmer\b/i,
  /\bwohnung\b/i,
  /\bapartment\b/i,
  /\bwg\b/i,
  /\bstudio\b/i,
  /\bm²|\bqm\b|\bsqm\b/i,
  /\bmiete\b/i,
  /\bzwischenmiete\b/i,
  /\bnachmieter\b/i,
  /\bflat\b/i,
];

export const telegramAdapter: DiscoveryAdapter = {
  key: 'telegram',
  label: 'Telegram-Kanal (öffentlich)',
  description:
    'Liest öffentliche Telegram-Kanäle über deren Web-Ansicht (t.me/s/name). Ohne Konto, ohne Anmeldung, ohne API-Schlüssel. Private Gruppen sind so nicht lesbar.',
  configKeys: [
    {
      key: 'channels',
      required: true,
      hint: 'Kanalnamen ohne @, einer pro Zeile — z. B. wohnungenberlin. Nur öffentliche Kanäle; im Browser prüfbar unter t.me/s/NAME.',
    },
    {
      key: 'requireCity',
      required: false,
      hint: 'Ortsname, der im Text vorkommen muss (z. B. Heilbronn). Ohne das liefert ein bundesweiter Kanal alles.',
    },
    {
      key: 'includeSeeking',
      required: false,
      hint: 'true, um auch Gesuche („suche Wohnung") aufzunehmen. Standard: nur Angebote.',
    },
  ],

  buildUrls(_query, config) {
    return cfgStringList(config, 'channels')
      .map((raw) => raw.trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\/(s\/)?/i, ''))
      .filter((name) => /^[A-Za-z0-9_]{4,64}$/.test(name))
      .map((name) => `${BASE}/s/${name}`);
  },

  parse(page, config) {
    if (!page.body) return [];

    const channel = channelOf(page.finalUrl ?? page.url);
    if (!channel) return [];

    const requireCity = typeof config.requireCity === 'string' ? config.requireCity.trim().toLowerCase() : '';
    const includeSeeking = config.includeSeeking === true;

    const out: DiscoveredListing[] = [];

    for (const block of splitByMarker(page.body, /<div class="tgme_widget_message[ "]/)) {
      const postId = firstMatch(block, /data-post="([^"]+)"/);
      if (!postId) continue;

      const rawText = firstMatch(block, /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (!rawText) continue;
      const text = messageText(rawText);
      if (text.length < 25) continue;

      if (!OFFER_HINTS.some((p) => p.test(text))) continue;
      if (!includeSeeking && SEEKING_PATTERNS.some((p) => p.test(text))) continue;
      if (requireCity && !text.toLowerCase().includes(requireCity)) continue;

      out.push({
        url: `${BASE}/${postId}`,
        // A channel post has no title, so the first meaningful line stands in.
        title: firstLine(text),
        description: text,
        locationRaw: '',
        locationCity: null,
        locationPostal: postalIn(text),
        imageUrl: firstMatch(block, /background-image:url\('([^']+)'\)/),
        contactName: `Telegram-Kanal @${channel}`,
        // Telegram timestamps every post to the second — the most exact
        // posting date any source gives us.
        postedAt: listPostedAt(firstMatch(block, /datetime="([^"]+)"/)),
        // Everything measurable is left to the German parser: a post has no
        // price field, and guessing one from free text twice would be worse
        // than doing it once, properly, where it is already tested.
        structured: {},
      });
    }

    return out;
  },
};

/** `https://t.me/s/wohnungenberlin` → `wohnungenberlin`. */
export function channelOf(url: string): string | null {
  const m = url.match(/t\.me\/s\/([A-Za-z0-9_]+)/i);
  return m ? m[1] : null;
}

function messageText(raw: string): string {
  return textOf(decodeEntities(raw.replace(/<br\s*\/?>/gi, '\n')))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 8000);
}

/**
 * The first line that carries actual information. Channel posts routinely open
 * with a row of emoji or a hashtag banner, which makes a useless title.
 */
function firstLine(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const withoutTags = line.replace(/#\w+/g, '').trim();
    // Strip leading emoji/punctuation before judging the length.
    const meaningful = withoutTags.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (meaningful.length >= 12) return meaningful.slice(0, 200);
  }

  return lines[0]?.slice(0, 200) ?? 'Telegram-Anzeige';
}

function postalIn(text: string): string | null {
  const m = text.match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

/** Exposed so the settings screen can sanity-check a channel name. */
export function normaliseChannelName(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/t\.me\/(s\/)?/i, '')
    .replace(/\/.*$/, '');
  return /^[A-Za-z0-9_]{4,64}$/.test(name) ? name : null;
}

export function parseTelegramPage(page: FetchedPage, config: Record<string, unknown> = {}) {
  return telegramAdapter.parse(page, config);
}
