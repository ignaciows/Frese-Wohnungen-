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

/* ------------------------------------------------- the tabs on results --- */

/**
 * The nine tabs of the results screen, in the order they appear.
 *
 * Here rather than in the page, because the count on each tab and the rows
 * under it must come from the same definition — see `matchWhere`.
 */
export const RESULT_TABS = [
  { key: 'zu-kontaktieren', label: 'Zu kontaktieren', always: true },
  { key: 'kontaktiert', label: 'Kontaktiert', always: true },
  { key: 'in-arbeit', label: 'In Arbeit', always: false },
  { key: 'wiedervorlage', label: 'Wiedervorlage', always: false },
  { key: 'favoriten', label: 'Favoriten', always: false },
  { key: 'zu-pruefen', label: 'Zu prüfen', always: false },
  { key: 'abgelehnt', label: 'Abgelehnt', always: false },
  { key: 'abgelaufen', label: 'Abgelaufen', always: false },
  { key: 'alle', label: 'Alle', always: true },
] as const;

export type ResultTab = (typeof RESULT_TABS)[number]['key'];

type MatchStatusValue = 'NEW' | 'FAVORITE' | 'IN_PROGRESS' | 'CONTACTED' | 'REJECTED' | 'EXPIRED';

/**
 * „Nicht als unpassend markiert" — die eine Definition von anschreibbar.
 *
 * Bewusst `not: INCOMPATIBLE` und nicht `in: [COMPATIBLE, NEAR_MATCH]`: dazwischen
 * liegt `INSUFFICIENT_DATA`, der Standardwert für jeden Treffer, dem noch Miete,
 * Zimmerzahl oder Fläche fehlt. Die Ergebnisliste zeigt die, weil eine Anzeige
 * ohne Quadratmeterangabe trotzdem die richtige Wohnung sein kann.
 *
 * Wer hier enger filtert als die Liste, baut denselben Fehler wie damals der
 * Zähler auf dem Reiter: die Tagesliste sagt „nichts offen", die Liste zeigt
 * vierzig Zeilen. Deshalb steht das hier einmal und wird von Tagesliste,
 * Meldungen und Stillstands-Warnung geteilt.
 */
export const USABLE_COMPATIBILITY = { not: 'INCOMPATIBLE' } as const;

/**
 * The working list holds nothing that cannot be written to.
 *
 * On a real candidate, 234 of 311 live matches were INCOMPATIBLE — three
 * quarters of the screen was flats in the wrong city, over budget, or the
 * wrong kind of property, each already marked "Nicht passend". Nobody writes
 * to those, and having to look past them to find the twenty-one that work is
 * the exact job this tool exists to remove. They stay reachable under "Alle".
 */
function statusFilter(tab: string): {
  status?: MatchStatusValue | { in: MatchStatusValue[] };
  compatibility?: { not: 'INCOMPATIBLE' };
} {
  switch (tab) {
    case 'zu-kontaktieren':
      return { status: { in: ['NEW', 'FAVORITE'] }, compatibility: { not: 'INCOMPATIBLE' } };
    case 'favoriten':
      return { status: 'FAVORITE' };
    case 'in-arbeit':
      return { status: 'IN_PROGRESS' };
    case 'kontaktiert':
      return { status: 'CONTACTED' };
    case 'abgelehnt':
      return { status: { in: ['REJECTED', 'EXPIRED'] } };
    default:
      return {};
  }
}

/**
 * The one filter behind both the rows of a tab and the number on it.
 *
 * This exists because the two used to be written separately, and they
 * disagreed — badly. "Zu kontaktieren" counted every match with status NEW or
 * FAVORITE and nothing else, while the list underneath *also* dropped the
 * INCOMPATIBLE ones and everything the link checker had confirmed gone. On a
 * real candidate the tab read **365** and the list showed **13** rows.
 *
 * A count that promises 365 and delivers 13 is worse than no count: it tells
 * somebody there is a pile of work they then cannot find, on the one list this
 * whole tool exists to make trustworthy. So there is now exactly one place
 * that decides what belongs in a tab, and both the rows and the number come
 * from it. `tests/resultTabs.test.ts` holds them to that.
 */
export function matchWhere(args: {
  candidateCaseId: string;
  tab: string;
  liveness?: LivenessPolicy;
  /** Ads retired before this stay out of "Abgelaufen"; the graveyard is short. */
  expiredCutoff: Date;
}): Prisma.CandidateListingMatchWhereInput {
  const { candidateCaseId, tab, liveness = DEFAULT_LIVENESS, expiredCutoff } = args;
  return {
    candidateCaseId,
    ...statusFilter(tab),
    ...(tab === 'wiedervorlage' ? { followUpAt: { not: null } } : {}),
    // Dead ads only show in their own tab, so the working list stays
    // trustworthy. A single confident GONE already hides the listing —
    // waiting for the second strike would keep sending people to a 404.
    //
    // The exception is anything we have already written to: a conversation
    // outlives the ad behind it, and hiding it would lose the reply we are
    // still waiting for. Those tabs therefore show live and dead alike.
    ...(tab === 'kontaktiert' || tab === 'in-arbeit'
      ? {}
      : {
          listing:
            tab === 'abgelaufen'
              ? { ...DEAD_LISTING, expiredAt: { gte: expiredCutoff } }
              : tab === 'zu-pruefen'
                ? limboListingFilter(liveness)
                : liveListingFilter(liveness),
        }),
  };
}
