/**
 * Runs the text detector over listings that are due, and retires the ones the
 * page itself says are gone.
 *
 * Each check is one request to a page a colleague already imported. We read the
 * page rather than trust its status code — see domain/liveness for why that is
 * the only thing that works on German portals — and store the resulting
 * percentage, the evidence behind it, and the publication date the ad prints
 * about itself.
 *
 * Politeness is deliberate: requests are serialised per host with a delay, the
 * run is capped, and each listing is only revisited on a long interval. This is
 * a handful of requests to pages we were already given — not a crawl.
 */

import { prisma } from '@/lib/prisma';
import { safeFetch } from '@/lib/safeFetch';
import {
  evaluateLiveness,
  isDueForCheck,
  nextGoneStreak,
  shouldAutoExpire,
  type LivenessPolicy,
} from '@/domain/liveness';
import { getLivenessSettings } from './settings';

export interface LivenessRunSummary {
  enabled: boolean;
  checked: number;
  alive: number;
  gone: number;
  blocked: number;
  unknown: number;
  expired: number;
  /** Ads that landed in the middle band and now need a human look. */
  limbo: number;
  /** Ads whose own publication date was read off the page this run. */
  dated: number;
  notes: string[];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLivenessChecks(
  options: {
    limit?: number;
    listingIds?: string[];
    force?: boolean;
    /**
     * Check the ads this candidate is actually looking at first. Opening a
     * result list should verify what is on screen, not whatever happened to be
     * oldest across the whole database.
     */
    candidateCaseId?: string;
  } = {},
): Promise<LivenessRunSummary> {
  const policy: LivenessPolicy = await getLivenessSettings();
  const summary: LivenessRunSummary = {
    enabled: policy.enabled,
    checked: 0,
    alive: 0,
    gone: 0,
    blocked: 0,
    unknown: 0,
    expired: 0,
    limbo: 0,
    dated: 0,
    notes: [],
  };

  if (!policy.enabled && !options.force) {
    summary.notes.push('Automatische Prüfung ist in den Einstellungen deaktiviert.');
    return summary;
  }

  const candidates = await prisma.listing.findMany({
    where: options.listingIds
      ? { id: { in: options.listingIds } }
      : {
          expired: false,
          ...(options.candidateCaseId
            ? { matches: { some: { candidateCaseId: options.candidateCaseId } } }
            : {}),
        },
    select: {
      id: true,
      rawUrl: true,
      canonicalUrl: true,
      title: true,
      importedAt: true,
      lastCheckedAt: true,
      expired: true,
      goneStreak: true,
    },
    orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
    take: (options.limit ?? policy.maxPerRun) * 3,
  });

  const due = options.force
    ? candidates
    : candidates.filter((l) => isDueForCheck(l, policy));
  const batch = due.slice(0, options.limit ?? policy.maxPerRun);

  // Spread requests across hosts so no single portal sees a burst.
  const lastHitByHost = new Map<string, number>();

  for (const listing of batch) {
    const host = hostOf(listing.rawUrl);
    const since = Date.now() - (lastHitByHost.get(host) ?? 0);
    if (since < policy.perHostDelayMs) await sleep(policy.perHostDelayMs - since);
    lastHitByHost.set(host, Date.now());

    // Read generously: the withdrawal notice is at the top of the page, but
    // "Online seit" is usually far below it.
    const res = await safeFetch(listing.rawUrl, { maxBytes: policy.maxBytesPerPage });
    const verdict = evaluateLiveness(
      {
        requestedUrl: listing.rawUrl,
        finalUrl: res.finalUrl,
        status: res.status,
        bodySnippet: res.bodySnippet,
        networkError: res.networkError,
      },
      policy,
    );

    summary.checked++;
    if (verdict.verdict === 'ALIVE') summary.alive++;
    else if (verdict.verdict === 'GONE') summary.gone++;
    else if (verdict.verdict === 'BLOCKED') summary.blocked++;
    else {
      summary.unknown++;
      summary.limbo++;
    }
    if (verdict.posted.at) summary.dated++;

    const streak = nextGoneStreak(listing.goneStreak, verdict);
    const expireNow = shouldAutoExpire(streak, policy);

    await prisma.listing.update({
      where: { id: listing.id },
      data: {
        lastCheckedAt: new Date(),
        lastCheckStatus: verdict.verdict,
        lastCheckReason: verdict.reason,
        goneStreak: streak,
        // Blocked and unreachable readings learned nothing about the ad, so
        // they must not overwrite a percentage an earlier real read produced.
        ...(verdict.verdict === 'BLOCKED' || res.networkError
          ? {}
          : {
              onlineConfidence: verdict.onlineConfidence,
              livenessSignals: verdict.signals as unknown as object,
            }),
        // The ad's own publication date, once found, is never unset by a later
        // check that could not read it — a portal that hides the date today
        // does not make the ad younger.
        ...(verdict.posted.at
          ? { postedAt: verdict.posted.at, postedAtLabel: verdict.posted.label }
          : {}),
        // A confirmed live page also refreshes the freshness clock.
        ...(verdict.verdict === 'ALIVE' ? { lastSeenAt: new Date() } : {}),
        ...(expireNow
          ? { expired: true, expiredAt: new Date(), expiredBySystem: true }
          : {}),
      },
    });

    if (expireNow) {
      summary.expired++;
      summary.notes.push(`„${listing.title}" als abgelaufen markiert: ${verdict.reason}`);
      await prisma.auditEvent.create({
        data: {
          entityType: 'Listing',
          entityId: listing.id,
          action: 'listing.autoExpire',
          toState: 'EXPIRED',
          reason: verdict.reason,
        },
      });
    }
  }

  if (summary.blocked > 0) {
    summary.notes.push(
      `${summary.blocked} Anzeige(n) konnten nicht geprüft werden, weil das Portal automatische Abrufe blockiert — sie bleiben unverändert.`,
    );
  }
  if (summary.limbo > 0) {
    summary.notes.push(
      `${summary.limbo} Anzeige(n) waren nicht eindeutig zu lesen — sie stehen als „zu prüfen" in der Liste, statt still zu verschwinden.`,
    );
  }

  return summary;
}

/** Immediate check for a single listing, used by the "jetzt prüfen" button. */
export async function checkSingleListing(listingId: string): Promise<LivenessRunSummary> {
  return runLivenessChecks({ listingIds: [listingId], limit: 1, force: true });
}
