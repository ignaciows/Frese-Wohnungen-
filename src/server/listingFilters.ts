/**
 * The definition of "this ad is still worth showing", in one place.
 *
 * It lives here because getting it subtly wrong is easy and expensive. The
 * obvious spelling — `NOT: { lastCheckStatus: 'GONE' }` — silently drops every
 * row where `lastCheckStatus` is NULL, because in SQL `NOT (NULL = 'GONE')` is
 * unknown, not true. NULL is the state of every ad the link checker has not
 * reached yet, which is most of them right after a discovery sweep. That bug
 * hid the majority of the live pool while looking entirely reasonable.
 *
 * So the NULL case is written out explicitly, and nobody has to remember why.
 */

import type { Prisma } from '@prisma/client';

/** Live ads: not retired, and not confirmed gone by the link checker. */
export const LIVE_LISTING: Prisma.ListingWhereInput = {
  expired: false,
  OR: [{ lastCheckStatus: null }, { lastCheckStatus: { not: 'GONE' } }],
};

/** The opposite: retired, or confirmed gone. */
export const DEAD_LISTING: Prisma.ListingWhereInput = {
  OR: [{ expired: true }, { lastCheckStatus: 'GONE' }],
};
