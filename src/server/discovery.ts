/**
 * The daily sweep: ask every configured source for its current result list,
 * fold what comes back into the shared listing pool, and retire whatever has
 * disappeared.
 *
 * Three design choices carry most of the weight:
 *
 *  1. **Queries are deduplicated across candidates.** Five nurses working at
 *     the same clinic produce one sweep, not five. Whatever it finds is matched
 *     to all of them by the existing ranking code.
 *
 *  2. **Disappearing from a result list is the cheapest death signal there is.**
 *     Long before a portal serves a 404, the ad is simply no longer in the
 *     list. `missedSweeps` counts that — but only across sweeps that themselves
 *     succeeded, so a blocked portal can never retire its own inventory.
 *
 *  3. **Nothing is retired that anybody contacted.** A conversation in progress
 *     outlives the ad behind it; the listing is marked gone but stays visible
 *     wherever that conversation is.
 */

import { prisma } from '@/lib/prisma';
import { Crawler } from './crawler';
import { getAdapter } from '@/domain/discovery/registry';
import { missingConfig } from '@/domain/discovery/registry';
import { parseDetailPage } from '@/domain/discovery/adapters/generic';
import {
  DEFAULT_QUERY,
  type AdapterConfig,
  type DiscoveredListing,
  type DiscoveryQuery,
} from '@/domain/discovery/types';
import { ingestListing } from './listingIngest';
import { normaliseUrl } from '@/lib/url';
import { getDiscoverySettings, type DiscoverySettings } from './settings';

export interface DiscoverySweepSummary {
  ran: boolean;
  skippedReason?: string;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesBlocked: number;
  found: number;
  created: number;
  updated: number;
  retired: number;
  enriched: number;
  requests: number;
  durationMs: number;
  notes: string[];
}

const EMPTY: DiscoverySweepSummary = {
  ran: false,
  sourcesAttempted: 0,
  sourcesSucceeded: 0,
  sourcesBlocked: 0,
  found: 0,
  created: 0,
  updated: 0,
  retired: 0,
  enriched: 0,
  requests: 0,
  durationMs: 0,
  notes: [],
};

/**
 * The account discovered ads are attributed to. Discovery has no human behind
 * it, and blaming whoever happened to open the page would corrupt the audit
 * trail, so it gets its own identity.
 */
export async function systemUserId(): Promise<string> {
  const email = 'system@frese-wohnung.local';
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email,
      name: 'Automatische Suche',
      // Not a login: no password hash can ever match this placeholder, and the
      // account is inactive, so it cannot be used to sign in.
      passwordHash: 'x',
      role: 'COLLEAGUE',
      active: false,
    },
    select: { id: true },
  });
  return created.id;
}

/* ------------------------------------------------------------ queries --- */

interface PlannedQuery {
  key: string;
  query: DiscoveryQuery;
  candidateCaseIds: string[];
}

/**
 * Turns the active candidates' saved profiles into the smallest set of
 * distinct searches that covers all of them. Where two candidates differ only
 * in budget, the higher cap wins — a cheaper flat is never filtered out by
 * searching with a larger budget, but the reverse loses ads.
 */
export async function planQueries(settings: DiscoverySettings): Promise<PlannedQuery[]> {
  const profiles = await prisma.searchProfile.findMany({
    where: { candidateCase: { status: 'ACTIVE', housingSecuredAt: null } },
    select: {
      candidateCaseId: true,
      workplaceCity: true,
      workplacePostalCode: true,
      radiusKm: true,
      maxCommuteMinutes: true,
      maxWarmmieteCents: true,
      minRooms: true,
      temporaryMode: true,
    },
  });

  const byKey = new Map<string, PlannedQuery>();

  for (const p of profiles) {
    const city = p.workplaceCity?.trim() || null;
    const postal = p.workplacePostalCode?.trim() || null;
    // Without a place there is nothing to search for; that candidate's profile
    // needs a workplace first, and the UI says so.
    if (!city && !postal) continue;

    // Fall back to a distance implied by the commute limit when no explicit
    // radius is set — roughly 1 km per minute by car on mixed roads.
    const radiusKm = p.radiusKm ?? (p.maxCommuteMinutes != null ? Math.min(60, p.maxCommuteMinutes) : 25);

    const key = [city ?? '', postal ?? '', radiusKm, p.temporaryMode ? 'T' : ''].join('|');
    const existing = byKey.get(key);

    if (existing) {
      existing.candidateCaseIds.push(p.candidateCaseId);
      existing.query.maxRentCents = Math.max(
        existing.query.maxRentCents ?? 0,
        Math.round(p.maxWarmmieteCents * settings.priceSlack),
      );
      existing.query.minRooms = Math.min(existing.query.minRooms ?? p.minRooms, p.minRooms);
      continue;
    }

    byKey.set(key, {
      key,
      candidateCaseIds: [p.candidateCaseId],
      query: {
        ...DEFAULT_QUERY,
        city,
        postalCode: postal,
        radiusKm,
        // Search a little above the cap: portals filter on Kaltmiete while our
        // limit is the Warmmiete, so an exact filter would hide flats whose
        // total is fine.
        maxRentCents: Math.round(p.maxWarmmieteCents * settings.priceSlack),
        minRooms: p.minRooms,
        includeTemporary: p.temporaryMode,
        maxPages: settings.maxPagesPerSource,
      },
    });
  }

  return [...byKey.values()];
}

/* -------------------------------------------------------------- sweep --- */

export async function runDiscoverySweep(
  options: { force?: boolean; sourceIds?: string[]; maxRequests?: number } = {},
): Promise<DiscoverySweepSummary> {
  const startedAt = Date.now();
  const settings = await getDiscoverySettings();
  const summary: DiscoverySweepSummary = { ...EMPTY, notes: [] };

  if (!settings.enabled && !options.force) {
    return { ...summary, skippedReason: 'Automatische Suche ist in den Einstellungen ausgeschaltet.' };
  }

  const sources = await prisma.source.findMany({
    where: {
      active: true,
      discoveryEnabled: true,
      ...(options.sourceIds ? { id: { in: options.sourceIds } } : {}),
    },
    orderBy: { priority: 'asc' },
  });

  if (sources.length === 0) {
    return {
      ...summary,
      skippedReason:
        'Keine Quelle ist für die automatische Suche freigeschaltet. In den Einstellungen unter „Quellen & Automatik" aktivieren.',
    };
  }

  const queries = await planQueries(settings);
  if (queries.length === 0) {
    return {
      ...summary,
      skippedReason:
        'Kein aktiver Kandidat hat einen Arbeitsort hinterlegt — ohne Ort lässt sich nicht suchen.',
    };
  }

  const crawler = new Crawler({
    perHostDelayMs: settings.perHostDelayMs,
    maxRequests: options.maxRequests ?? settings.maxRequestsPerRun,
  });
  const importedById = await systemUserId();
  summary.ran = true;

  for (const source of sources) {
    const adapter = getAdapter(source.discoveryAdapter);
    if (!adapter) continue;

    const baseConfig = (source.discoveryConfig ?? {}) as AdapterConfig;
    const gaps = missingConfig(source.discoveryAdapter, baseConfig);
    if (gaps.length > 0) {
      await noteSourceStatus(source.id, 'ERROR', `Konfiguration unvollständig: ${gaps.join(', ')}`);
      summary.notes.push(`${source.name}: Konfiguration unvollständig (${gaps.join(', ')}).`);
      continue;
    }

    summary.sourcesAttempted++;
    const seenUrls = new Set<string>();
    let sourceOk = false;
    let sourceBlocked = false;

    for (const planned of queries) {
      if (crawler.budgetLeft <= 0) {
        summary.notes.push('Anfrage-Budget für diesen Lauf erreicht — Rest folgt beim nächsten Lauf.');
        break;
      }

      const runStart = Date.now();
      let config = baseConfig;
      let status = 'OK';
      let message: string | null = null;
      let found = 0;
      let created = 0;
      let updated = 0;

      try {
        if (adapter.prepare) {
          const prepared = await adapter.prepare(planned.query, config, (u) => crawler.fetchPage(u));
          if (!prepared) {
            status = 'SKIPPED';
            message = 'Quelle konnte den Ort nicht auflösen — Suche würde sonst bundesweit laufen.';
          } else {
            config = prepared;
          }
        }

        if (status === 'OK') {
          const urls = adapter.buildUrls(planned.query, config);
          if (urls.length === 0) {
            status = 'SKIPPED';
            message = 'Adapter kann diese Suche nicht abbilden.';
          }

          const collected: DiscoveredListing[] = [];
          for (const url of urls) {
            if (crawler.budgetLeft <= 0) break;
            const page = await crawler.fetchPage(url);

            if (page.error?.includes('robots.txt')) {
              status = 'ROBOTS_DENIED';
              message = 'robots.txt der Quelle untersagt diesen Pfad.';
              break;
            }
            if (page.blocked) {
              status = 'BLOCKED';
              message = page.error ?? 'Portal blockiert automatische Abrufe.';
              break;
            }
            if (page.error) {
              status = 'ERROR';
              message = page.error;
              break;
            }

            let parsed: DiscoveredListing[] = [];
            try {
              parsed = adapter.parse(page, config);
            } catch (err) {
              status = 'ERROR';
              message = `Auswertung fehlgeschlagen: ${(err as Error).message}`.slice(0, 300);
              break;
            }
            collected.push(...parsed);
            // An empty page means we walked past the last result; going
            // further just wastes requests on the portal's 404 handler.
            if (parsed.length === 0) break;
          }

          for (const item of collected) {
            const canonical = normaliseUrl(item.url);
            if (seenUrls.has(canonical)) continue;
            seenUrls.add(canonical);
            found++;

            const result = await upsertDiscovered(source.id, item, importedById);
            if (result === 'created') created++;
            else if (result === 'updated') updated++;
          }
        }
      } catch (err) {
        status = 'ERROR';
        message = (err as Error).message.slice(0, 300);
      }

      if (status === 'OK') sourceOk = true;
      if (status === 'BLOCKED' || status === 'ROBOTS_DENIED') sourceBlocked = true;

      summary.found += found;
      summary.created += created;
      summary.updated += updated;

      await prisma.discoveryRun.create({
        data: {
          sourceId: source.id,
          adapter: adapter.key,
          candidateCaseId: planned.candidateCaseIds.length === 1 ? planned.candidateCaseIds[0] : null,
          query: planned.query as never,
          status,
          found,
          created,
          updated,
          message,
          finishedAt: new Date(),
          durationMs: Date.now() - runStart,
        },
      });

      if (status !== 'OK') {
        summary.notes.push(`${source.name}: ${message ?? status}`);
        // A blocked or denied source will not behave differently for the next
        // candidate's query, so stop asking it this sweep.
        if (status === 'BLOCKED' || status === 'ROBOTS_DENIED') break;
      }
    }

    if (sourceOk) {
      summary.sourcesSucceeded++;
      summary.retired += await retireUnseen(source.id, seenUrls, settings);
      await noteSourceStatus(source.id, 'OK', null);
    } else if (sourceBlocked) {
      summary.sourcesBlocked++;
      await noteSourceStatus(source.id, 'BLOCKED', 'Portal blockiert automatische Abrufe.');
    }
  }

  summary.enriched = await enrichNewListings(crawler, settings);
  summary.requests = crawler.stats.requests;
  summary.durationMs = Date.now() - startedAt;

  if (summary.sourcesBlocked > 0) {
    summary.notes.push(
      `${summary.sourcesBlocked} Quelle(n) blockieren automatische Abrufe — dort bleibt der manuelle Weg bzw. der E-Mail-Suchauftrag.`,
    );
  }

  return summary;
}

/* ------------------------------------------------------------- upsert --- */

async function upsertDiscovered(
  sourceId: string,
  item: DiscoveredListing,
  importedById: string,
): Promise<'created' | 'updated' | 'skipped'> {
  const canonicalUrl = normaliseUrl(item.url);
  const now = new Date();

  const existing = await prisma.listing.findUnique({
    where: { canonicalUrl },
    select: { id: true, expired: true, expiredBySystem: true },
  });

  if (existing) {
    // Seeing an ad in the result list again is proof it is live. If we had
    // retired it ourselves, that verdict was wrong — undo it.
    await prisma.listing.update({
      where: { id: existing.id },
      data: {
        lastListedAt: now,
        lastSeenAt: now,
        missedSweeps: 0,
        goneStreak: 0,
        ...(existing.expired && existing.expiredBySystem
          ? { expired: false, expiredAt: null, expiredBySystem: false }
          : {}),
      },
    });
    return 'updated';
  }

  try {
    const { listingId } = await ingestListing({
      sourceId,
      rawUrl: item.url,
      title: item.title,
      descriptionRaw: item.description,
      locationRaw: item.locationRaw,
      locationCity: item.locationCity ?? null,
      locationPostal: item.locationPostal ?? null,
      imageUrl: item.imageUrl ?? null,
      importedById,
      structured: item.structured,
    });

    await prisma.listing.update({
      where: { id: listingId },
      data: {
        origin: 'DISCOVERY',
        firstSeenAt: now,
        lastListedAt: now,
        lastSeenAt: now,
        missedSweeps: 0,
        ...(item.contactEmail ? { contactEmail: item.contactEmail } : {}),
        ...(item.contactName ? { contactName: item.contactName } : {}),
        ...(item.contactFormUrl ? { contactFormUrl: item.contactFormUrl } : {}),
      },
    });
    return 'created';
  } catch {
    // A single malformed ad must never abort a sweep of several hundred.
    return 'skipped';
  }
}

/* ------------------------------------------------------------- retire --- */

/**
 * Ads from this source that the sweep did not see. Each miss is counted, and
 * only a listing that has been missing from several consecutive *successful*
 * sweeps is retired.
 */
async function retireUnseen(
  sourceId: string,
  seenUrls: Set<string>,
  settings: DiscoverySettings,
): Promise<number> {
  const live = await prisma.listing.findMany({
    where: { sourceId, expired: false, origin: 'DISCOVERY' },
    select: { id: true, canonicalUrl: true, missedSweeps: true, title: true },
  });

  const missing = live.filter((l) => !seenUrls.has(l.canonicalUrl));
  if (missing.length === 0) return 0;

  // A source whose entire inventory vanished at once is far more likely to
  // have changed its markup than to have rented out every flat overnight.
  if (live.length >= 5 && missing.length === live.length) {
    await noteSourceStatus(
      sourceId,
      'ERROR',
      'Kein einziger bekannter Treffer mehr in der Ergebnisliste — vermutlich hat sich die Seitenstruktur geändert. Es wurde nichts ausgeblendet.',
    );
    return 0;
  }

  const dueForRetirement = missing.filter((l) => l.missedSweeps + 1 >= settings.retireAfterMissedSweeps);
  const stillCounting = missing.filter((l) => l.missedSweeps + 1 < settings.retireAfterMissedSweeps);

  if (stillCounting.length > 0) {
    await prisma.listing.updateMany({
      where: { id: { in: stillCounting.map((l) => l.id) } },
      data: { missedSweeps: { increment: 1 } },
    });
  }

  if (dueForRetirement.length === 0) return 0;

  const ids = dueForRetirement.map((l) => l.id);
  const now = new Date();
  await prisma.listing.updateMany({
    where: { id: { in: ids } },
    data: {
      missedSweeps: { increment: 1 },
      expired: true,
      expiredAt: now,
      expiredBySystem: true,
      lastCheckStatus: 'GONE',
      lastCheckReason: 'Nicht mehr in der Ergebnisliste der Quelle',
    },
  });
  await prisma.candidateListingMatch.updateMany({
    where: { listingId: { in: ids }, status: { in: ['NEW', 'FAVORITE'] } },
    data: { status: 'EXPIRED' },
  });
  await prisma.auditEvent.createMany({
    data: ids.map((id) => ({
      entityType: 'Listing',
      entityId: id,
      action: 'listing.autoRetire',
      toState: 'EXPIRED',
      reason: `Nach ${settings.retireAfterMissedSweeps} Durchläufen nicht mehr in der Ergebnisliste`,
    })),
  });

  return ids.length;
}

/* ------------------------------------------------------------- enrich --- */

/**
 * Reads detail pages for ads we only know from a result list.
 *
 * Newest first and strictly bounded: the point is to fill in Nebenkosten,
 * availability and contact details for the ads a colleague is about to look
 * at, not to mirror the portal.
 */
async function enrichNewListings(crawler: Crawler, settings: DiscoverySettings): Promise<number> {
  if (settings.enrichPerRun <= 0 || crawler.budgetLeft <= 0) return 0;

  const pending = await prisma.listing.findMany({
    where: {
      origin: 'DISCOVERY',
      expired: false,
      // Never enriched: no detail read has happened yet.
      lastCheckedAt: null,
    },
    orderBy: { firstSeenAt: 'desc' },
    take: Math.min(settings.enrichPerRun, crawler.budgetLeft),
    select: {
      id: true,
      rawUrl: true,
      sourceId: true,
      title: true,
      locationRaw: true,
      locationCity: true,
      locationPostal: true,
      imageUrl: true,
      kaltMieteCents: true,
      warmMieteCents: true,
      nebenkostenCents: true,
      rooms: true,
      livingSpaceSqm: true,
    },
  });

  let enriched = 0;
  const importedById = await systemUserId();

  for (const listing of pending) {
    if (crawler.budgetLeft <= 0) break;
    const page = await crawler.fetchPage(listing.rawUrl);

    if (page.blocked || page.error || !page.body) {
      // Record the attempt so we do not retry the same dead end every sweep.
      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          lastCheckedAt: new Date(),
          lastCheckStatus: page.blocked ? 'BLOCKED' : 'UNKNOWN',
          lastCheckReason: page.error ?? 'Detailseite nicht lesbar',
        },
      });
      continue;
    }

    const detail = parseDetailPage(page);
    if (!detail) continue;

    // Re-run the full parser over the real description: the teaser from a
    // result list is usually truncated mid-sentence, so Nebenkosten and WBS
    // hints only exist here.
    //
    // Everything the detail page does *not* mention keeps the value the result
    // list already gave us. Detail pages routinely omit the price (it sits in
    // a widget) and the postcode, and letting a null overwrite a known figure
    // would make enrichment actively destructive.
    if (detail.description && detail.description.length > 40) {
      try {
        await ingestListing({
          sourceId: listing.sourceId,
          rawUrl: listing.rawUrl,
          title: detail.title || listing.title,
          descriptionRaw: detail.description,
          locationRaw: detail.locationRaw || listing.locationRaw,
          locationCity: detail.locationCity ?? listing.locationCity,
          locationPostal: detail.locationPostal ?? listing.locationPostal,
          imageUrl: detail.imageUrl ?? listing.imageUrl,
          importedById,
          structured: {
            kaltMieteCents: detail.structured?.kaltMieteCents ?? listing.kaltMieteCents,
            warmMieteCents: detail.structured?.warmMieteCents ?? listing.warmMieteCents,
            nebenkostenCents: detail.structured?.nebenkostenCents ?? listing.nebenkostenCents,
            rooms: detail.structured?.rooms ?? listing.rooms,
            livingSpaceSqm: detail.structured?.livingSpaceSqm ?? listing.livingSpaceSqm,
          },
        });
      } catch {
        // Keep whatever the result list gave us.
      }
    }

    await prisma.listing.update({
      where: { id: listing.id },
      data: {
        lastCheckedAt: new Date(),
        lastCheckStatus: 'ALIVE',
        lastCheckReason: 'Detailseite gelesen',
        lastSeenAt: new Date(),
        ...(detail.contactEmail ? { contactEmail: detail.contactEmail } : {}),
        ...(detail.contactName ? { contactName: detail.contactName } : {}),
      },
    });
    enriched++;
  }

  return enriched;
}

/* ------------------------------------------------------------ helpers --- */

async function noteSourceStatus(sourceId: string, status: string, note: string | null): Promise<void> {
  await prisma.source.update({
    where: { id: sourceId },
    data: { discoveryStatus: status, discoveryNote: note, lastDiscoveredAt: new Date() },
  });
}

/**
 * Throttled entry point used when someone opens the app. Returns immediately
 * when a sweep already ran recently, so the page never waits on the network
 * more than it has to.
 */
export async function maybeRunDiscoverySweep(): Promise<DiscoverySweepSummary> {
  const settings = await getDiscoverySettings();
  if (!settings.enabled) {
    return { ...EMPTY, skippedReason: 'Automatische Suche ist ausgeschaltet.' };
  }

  const last = await prisma.discoveryRun.findFirst({
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  if (last && Date.now() - last.startedAt.getTime() < settings.sweepIntervalMinutes * 60_000) {
    return { ...EMPTY, skippedReason: 'Zuletzt vor Kurzem gesucht.' };
  }

  return runDiscoverySweep();
}
