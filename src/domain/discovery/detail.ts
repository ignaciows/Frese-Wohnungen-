/**
 * Reading one advert's own page.
 *
 * A result list is a teaser. It shows the Kaltmiete and a photo, and leaves out
 * exactly the things that decide whether an advert is worth a message: the
 * Nebenkosten, the move-in date, whether a WBS is required — and, most
 * valuable of all, a phone number.
 *
 * So after a sweep, the newest handful of adverts get their detail page read.
 * Strictly bounded (see `enrichNewListings` in server/discovery.ts): the point
 * is to fill in the flats a colleague is about to look at, not to mirror the
 * portal.
 *
 * Nothing here is site-specific. It reads the schema.org block that most
 * property CMSs emit for Google, falls back to the Open Graph tags, and finally
 * to the page text — in that order, because that is the order of how much you
 * can trust them.
 */

import {
  absoluteUrl,
  decodeEntities,
  firstMatch,
  flattenJsonLd,
  jsonLdBlocks,
  parseGermanNumber,
  parsePriceCents,
  textOf,
  typesOf,
} from './html';
import { findContact } from '@/domain/contact';
import type { DiscoveredListing, FetchedPage } from './types';

/** schema.org types that describe something rentable. */
const LISTING_TYPES = [
  'realestatelisting',
  'apartment',
  'house',
  'singlefamilyresidence',
  'accommodation',
  'residence',
  'suite',
  'room',
  'offer',
  'product',
];

/**
 * Everything the detail page adds to what the result list already said.
 * Returns null when the page could not be read at all; individual fields are
 * null when the page did not state them. Nothing is ever guessed — a made-up
 * Nebenkosten figure would quietly poison the ranking.
 */
export function parseDetailPage(page: FetchedPage): Partial<DiscoveredListing> | null {
  if (!page.body) return null;
  const base = page.finalUrl ?? page.url;
  const html = page.body;

  const nodes = flattenJsonLd(jsonLdBlocks(html));
  const listingNode = nodes.find((n) => typesOf(n).some((t) => LISTING_TYPES.includes(t)));

  const title =
    (listingNode ? str(listingNode.name) : null) ??
    firstMatch(html, /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ??
    firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);

  const description =
    (listingNode ? str(listingNode.description) : null) ??
    firstMatch(html, /<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ??
    firstMatch(html, /<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ??
    bodyText(html);

  // The contact block is the whole reason the detail fetch pays for itself:
  // a landlord who prints a number gets phoned today instead of e-mailed and
  // waited on. See domain/contact.
  const contact = findContact(textOf(html), { mailtoHref: firstMatch(html, /mailto:([^"'?\s>]+@[^"'?\s>]+)/i) });

  const result: Partial<DiscoveredListing> = {
    ...(title ? { title: textOf(title).slice(0, 300) } : {}),
    ...(description ? { description: textOf(description).slice(0, 20_000) } : {}),
    contactEmail: contact.email,
    contactPhone: contact.phone,
    imageUrl:
      (listingNode ? imageOf(listingNode, base) : null) ??
      firstMatch(html, /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i),
  };

  if (listingNode) {
    result.structured = {
      kaltMieteCents: priceOf(listingNode),
      rooms: numberOf(listingNode, ['numberOfRooms', 'numberOfBedrooms']),
      livingSpaceSqm: areaOf(listingNode),
    };
    Object.assign(result, addressOf(listingNode));
  }

  return result;
}

/* ------------------------------------------------- schema.org readers --- */
/* All of these return null rather than throwing: a portal that changes its
   markup should cost us a field, never a sweep. */

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return decodeEntities(value.trim());
  if (typeof value === 'number') return String(value);
  return null;
}

function addressOf(
  node: Record<string, unknown>,
): Pick<DiscoveredListing, 'locationRaw' | 'locationCity' | 'locationPostal'> {
  const address = node.address;
  if (typeof address === 'string') {
    return { locationRaw: address, locationCity: null, locationPostal: null };
  }
  if (address && typeof address === 'object') {
    const a = address as Record<string, unknown>;
    const city = str(a.addressLocality);
    const postal = str(a.postalCode);
    const street = str(a.streetAddress);
    return {
      locationRaw: [street, postal, city].filter(Boolean).join(', '),
      locationCity: city,
      locationPostal: postal,
    };
  }
  return { locationRaw: '', locationCity: null, locationPostal: null };
}

function imageOf(node: Record<string, unknown>, base: string): string | null {
  const image = node.image;
  const raw =
    typeof image === 'string'
      ? image
      : Array.isArray(image) && typeof image[0] === 'string'
        ? (image[0] as string)
        : image && typeof image === 'object'
          ? str((image as Record<string, unknown>).url)
          : null;
  return raw ? absoluteUrl(raw, base) : null;
}

function priceOf(node: Record<string, unknown>): number | null {
  const offers = node.offers ?? node;
  const candidates = Array.isArray(offers) ? offers : [offers];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const o = candidate as Record<string, unknown>;
    const raw = o.price ?? o.lowPrice ?? (o.priceSpecification as Record<string, unknown> | undefined)?.price;
    const cents = typeof raw === 'number' ? Math.round(raw * 100) : parsePriceCents(str(raw));
    if (cents != null) return cents;
  }
  return null;
}

function numberOf(node: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = node[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const v = (raw as Record<string, unknown>).value;
      if (typeof v === 'number') return v;
      const parsed = parseGermanNumber(str(v));
      if (parsed != null) return parsed;
    }
    const parsed = parseGermanNumber(str(raw));
    if (parsed != null) return parsed;
  }
  return null;
}

function areaOf(node: Record<string, unknown>): number | null {
  const area = node.floorSize ?? node.area;
  if (!area) return null;
  if (typeof area === 'number') return area;
  if (typeof area === 'object') {
    const v = (area as Record<string, unknown>).value;
    if (typeof v === 'number') return v;
    return parseGermanNumber(str(v));
  }
  return parseGermanNumber(str(area));
}

/** Last resort for the description: the page's own main content. */
function bodyText(html: string): string | null {
  const main =
    firstMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i) ??
    firstMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (!main) return null;
  const text = textOf(main);
  return text.length > 40 ? text : null;
}
