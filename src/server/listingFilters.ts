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
import { DEFAULT_LIVENESS, type LivenessPolicy } from '@/domain/liveness';

/** Live ads: not retired, and not confirmed gone by the text detector. */
export const LIVE_LISTING: Prisma.ListingWhereInput = {
  expired: false,
  OR: [{ lastCheckStatus: null }, { lastCheckStatus: { not: 'GONE' } }],
};

/** The opposite: retired, or confirmed gone. */
export const DEAD_LISTING: Prisma.ListingWhereInput = {
  OR: [{ expired: true }, { lastCheckStatus: 'GONE' }],
};

/**
 * Live ads under the strictness the admin chose.
 *
 * Default (`showOnlyConfirmedActive: false`): everything not confirmed gone,
 * including ads the detector could not read. Those are the "limbo" ads, and
 * they stay visible on purpose — the detector reads text and is sometimes
 * wrong, and an ad hidden by a bad guess is one nobody ever hears about again.
 *
 * Strict: only ads the detector confirmed. Quieter and smaller, and it will
 * occasionally hide a perfectly good flat behind a portal that blocks us —
 * which is why it is a choice rather than the default.
 */
export function liveListingFilter(policy: LivenessPolicy = DEFAULT_LIVENESS): Prisma.ListingWhereInput {
  if (!policy.showOnlyConfirmedActive) return LIVE_LISTING;
  return {
    expired: false,
    lastCheckStatus: 'ALIVE',
    onlineConfidence: { gte: policy.aliveAtOrAbove },
  };
}

/**
 * The middle band: checked, not confirmed gone, not confirmed live. Used for
 * the "zu prüfen" tab, so uncertainty has somewhere to be looked at rather than
 * being averaged into the main list.
 */
export function limboListingFilter(policy: LivenessPolicy = DEFAULT_LIVENESS): Prisma.ListingWhereInput {
  return {
    expired: false,
    onlineConfidence: { gt: policy.goneAtOrBelow, lt: policy.aliveAtOrAbove },
  };
}
