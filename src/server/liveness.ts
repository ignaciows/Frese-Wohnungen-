/**
 * Runs the liveness check over listings that are due, and retires the ones
 * that are confidently gone.
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
  options: { limit?: number; listingIds?: string[]; force?: boolean } = {},
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
    notes: [],
  };

  if (!policy.enabled && !options.force) {
    summary.notes.push('Automatische Prüfung ist in den Einstellungen deaktiviert.');
    return summary;
  }

  const candidates = await prisma.listing.findMany({
    where: options.listingIds ? { id: { in: options.listingIds } } : { expired: false },
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

    const res = await safeFetch(listing.rawUrl);
    const verdict = evaluateLiveness({
      requestedUrl: listing.rawUrl,
      finalUrl: res.finalUrl,
      status: res.status,
      bodySnippet: res.bodySnippet,
      networkError: res.networkError,
    });

    summary.checked++;
    if (verdict.verdict === 'ALIVE') summary.alive++;
    else if (verdict.verdict === 'GONE') summary.gone++;
    else if (verdict.verdict === 'BLOCKED') summary.blocked++;
    else summary.unknown++;

    const streak = nextGoneStreak(listing.goneStreak, verdict);
    const expireNow = shouldAutoExpire(streak, policy);

    await prisma.listing.update({
      where: { id: listing.id },
      data: {
        lastCheckedAt: new Date(),
        lastCheckStatus: verdict.verdict,
        lastCheckReason: verdict.reason,
        goneStreak: streak,
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

  return summary;
}

/** Immediate check for a single listing, used by the "jetzt prüfen" button. */
export async function checkSingleListing(listingId: string): Promise<LivenessRunSummary> {
  return runLivenessChecks({ listingIds: [listingId], limit: 1, force: true });
}
