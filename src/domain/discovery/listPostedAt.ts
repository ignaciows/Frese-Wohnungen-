/**
 * Reading a posting date out of a *result list*.
 *
 * The detail-page reader in `domain/liveness/postedAt` handles the hard case:
 * finding a date buried in prose on a page we fetched. This handles the easy
 * one — several sources print the date in the list itself, in a field of their
 * own.
 *
 * It is worth having both. Only a bounded number of ads get a detail fetch per
 * sweep, so relying on that alone leaves most of the pool undated; taking the
 * date from the list gives every ad one the moment it is discovered. The
 * formats and the plausibility bounds are the detail reader's, so there is one
 * place where "is this a sane date" is decided.
 */

import { parseDateish, parseRelative, postedAtLabel } from '@/domain/liveness/postedAt';

export interface ListPostedAt {
  at: Date;
  /** Ready-to-show German label, matching the detail reader's wording. */
  label: string;
}

/** Sanity bounds, mirroring the detail reader: an ad from 2019 is a bug. */
const MAX_AGE_DAYS = 400;
const MAX_FUTURE_DAYS = 2;

/**
 * Parses whatever the list printed. Returns null rather than a guess — an
 * invented date would be worse than none, because the whole point of the field
 * is deciding how urgently to act.
 */
export function listPostedAt(raw: string | null | undefined, now: Date = new Date()): ListPostedAt | null {
  const value = raw?.trim();
  if (!value) return null;

  const at = parseDateish(value) ?? parseRelative(value, now);
  if (!at || Number.isNaN(at.getTime())) return null;

  const diffDays = (now.getTime() - at.getTime()) / 86_400_000;
  if (diffDays < -MAX_FUTURE_DAYS || diffDays > MAX_AGE_DAYS) return null;

  return { at, label: postedAtLabel(at, now) };
}
