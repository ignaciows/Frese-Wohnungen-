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
import { isPlausibleHousing } from '@/domain/discovery/plausible';
import { LOCATION_CACHE_KEY } from '@/domain/discovery/adapters/kleinanzeigenLocations';
import { checkBatchLocation } from '@/domain/discovery/locationSanity';
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

  const now = Date.now();

  for (const source of sources) {
    const adapter = getAdapter(source.discoveryAdapter);
    if (!adapter) continue;

    // Sources move at very different speeds. A marketplace where a good flat
    // is gone within the hour is worth asking every few minutes; a municipal
    // landlord that posts twice a month is not, and asking anyway spends the
    // request budget that the fast source needs. An explicit run
    // (`force`, or a hand-picked source list) always goes ahead.
    if (!options.force && !options.sourceIds && source.pollIntervalMinutes != null && source.lastDiscoveredAt) {
      const dueIn = source.pollIntervalMinutes * 60_000 - (now - source.lastDiscoveredAt.getTime());
      if (dueIn > 0) continue;
    }

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
    // Counted across every query for this source, because the verdict "this
    // source only returns links we already know are unreadable" is about the
    // source, not about one city's search.
    let sourceFound = 0;
    let sourceUnreadable = 0;

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
      let rejected = 0;
      let unreadable = 0;

      try {
        if (adapter.prepare) {
          const prepared = await adapter.prepare(planned.query, config, (u) => crawler.fetchPage(u));
          if (!prepared) {
            status = 'SKIPPED';
            message = 'Quelle konnte den Ort nicht auflösen — Suche würde sonst bundesweit laufen.';
          } else {
            config = prepared;
            await rememberLookups(source.id, baseConfig, prepared);
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

          // Before anything is written: did this source answer about the town
          // we asked about? A wrong internal town number returns a full page of
          // real adverts from somewhere else, and every later stage treats them
          // as good data. Rejecting the batch here is the only place the
          // mistake is still visible.
          const sanity = checkBatchLocation(
            planned.query.postalCode,
            collected.map((c) => c.locationPostal),
          );
          if (!sanity.ok) {
            status = 'ERROR';
            message = sanity.note;
            collected.length = 0;
          }

          for (const item of collected) {
            const canonical = normaliseUrl(item.url);
            if (seenUrls.has(canonical)) continue;
            seenUrls.add(canonical);
            found++;

            const result = await upsertDiscovered(source.id, item, importedById);
            if (result === 'created') created++;
            else if (result === 'updated') updated++;
            else if (result === 'rejected') rejected++;
            else if (result === 'unreadable') {
              // Still an update as far as the row is concerned; counted apart
              // so the source can be told what it is really contributing.
              updated++;
              unreadable++;
            }
          }
        }
      } catch (err) {
        status = 'ERROR';
        message = (err as Error).message.slice(0, 300);
      }

      if (status === 'OK') sourceOk = true;
      if (status === 'BLOCKED' || status === 'ROBOTS_DENIED') sourceBlocked = true;
      sourceFound += found;
      sourceUnreadable += unreadable;

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
          message:
            rejected > 0
              ? `${message ? message + ' — ' : ''}${rejected} Treffer verworfen (kein Wohnraum).`
              : message,
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
      const verdict = describeYield(sourceFound, sourceUnreadable);
      await noteSourceStatus(source.id, 'OK', verdict);
      if (verdict) summary.notes.push(`${source.name}: ${verdict}`);
    } else if (sourceBlocked) {
      summary.sourcesBlocked++;
      await noteSourceStatus(source.id, 'BLOCKED', 'Portal blockiert automatische Abrufe.');
    }
  }

  const enrichment = await enrichNewListings(crawler, settings);
  summary.enriched = enrichment.enriched;
  summary.retired += enrichment.unreadable;
  if (enrichment.unreadable > 0) {
    summary.notes.push(
      `${enrichment.unreadable} Treffer ohne Miete, Zimmer oder Fläche entfernt — dort war nichts Verwertbares zu lesen.`,
    );
  }
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
): Promise<'created' | 'updated' | 'skipped' | 'rejected' | 'unreadable'> {
  const canonicalUrl = normaliseUrl(item.url);
  const now = new Date();

  const existing = await prisma.listing.findUnique({
    where: { canonicalUrl },
    select: {
      id: true,
      expired: true,
      expiredBySystem: true,
      postedAt: true,
      lastCheckStatus: true,
    },
  });

  if (!existing) {
    // Generic adapters buy breadth at the cost of precision: pointed at a
    // landlord's site, a link-list happily returns the navigation too. Judge
    // new items before they enter the pool — a list you have to mentally
    // filter is the thing this tool exists to remove. Anything already known
    // is left alone, because a colleague may have corrected it by hand.
    const verdict = isPlausibleHousing({
      title: item.title,
      description: item.description,
      structured: item.structured,
      url: item.url,
    });
    if (!verdict.plausible) return 'rejected';
  }

  if (existing) {
    const permanentlyUnreadable = existing.expired && existing.lastCheckStatus === 'UNREADABLE';
    // Seeing an ad in the result list again is proof it is live. If we had
    // retired it ourselves, that verdict was wrong — undo it.
    await prisma.listing.update({
      where: { id: existing.id },
      data: {
        lastListedAt: now,
        lastSeenAt: now,
        missedSweeps: 0,
        goneStreak: 0,
        // Backfill the publication date onto ads imported before we read it.
        // Never overwritten once known: a portal that stops printing the date
        // does not make the ad younger.
        ...(item.postedAt && !existing.postedAt
          ? { postedAt: item.postedAt.at, postedAtLabel: item.postedAt.label }
          : {}),
        // Reappearing in the result list proves an ad is live, so a retirement
        // we made for *disappearing* was wrong and gets undone.
        //
        // Not so for one retired as unreadable: those never had any content of
        // their own and their detail page refuses us, so being listed again
        // changes nothing. Undoing it anyway produced a loop — resurrect,
        // re-fetch, retire — that burned the entire enrichment budget on the
        // same dead links every sweep, starving the ads that could have been
        // filled in.
        ...(existing.expired && existing.expiredBySystem && existing.lastCheckStatus !== 'UNREADABLE'
          ? { expired: false, expiredAt: null, expiredBySystem: false }
          : {}),
      },
    });
    return permanentlyUnreadable ? 'unreadable' : 'updated';
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
        // Several sources print the date in the result list itself. Taking it
        // here gives every ad a posting date immediately, rather than only the
        // bounded number that get a detail read each sweep.
        ...(item.postedAt ? { postedAt: item.postedAt.at, postedAtLabel: item.postedAt.label } : {}),
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
export async function retireUnseen(
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
async function enrichNewListings(
  crawler: Crawler,
  settings: DiscoverySettings,
): Promise<{ enriched: number; unreadable: number }> {
  if (settings.enrichPerRun <= 0 || crawler.budgetLeft <= 0) return { enriched: 0, unreadable: 0 };

  const budget = Math.min(settings.enrichPerRun, crawler.budgetLeft);
  const select = {
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
    } as const;

  const never = { origin: 'DISCOVERY', expired: false, lastCheckedAt: null } as const;

  // Serve the ads that have nothing first.
  //
  // Enrichment exists precisely for entries a link-list produced as a bare URL
  // — no title, no price, no size. Ordering purely by "newest" meant a busy
  // source like Kleinanzeigen, whose ads already arrive complete, filled the
  // whole per-sweep budget every time, and the empty ones were never reached.
  // They then sat in the pool indefinitely: 31 of 85 in a live run.
  const empty = await prisma.listing.findMany({
    where: {
      ...never,
      kaltMieteCents: null,
      warmMieteCents: null,
      rooms: null,
      livingSpaceSqm: null,
    },
    orderBy: { firstSeenAt: 'desc' },
    take: budget,
    select,
  });

  // Whatever budget is left goes to the newest, to deepen ads that already
  // look usable.
  const rest =
    empty.length >= budget
      ? []
      : await prisma.listing.findMany({
          where: { ...never, id: { notIn: empty.map((l) => l.id) } },
          orderBy: { firstSeenAt: 'desc' },
          take: budget - empty.length,
          select,
        });

  const pending = [...empty, ...rest];

  let enriched = 0;
  let unreadable = 0;
  const importedById = await systemUserId();

  for (const listing of pending) {
    if (crawler.budgetLeft <= 0) break;
    const page = await crawler.fetchPage(listing.rawUrl);

    if (page.blocked || page.error || !page.body) {
      // A link-list entry starts out as nothing but a URL: the anchor wrapped a
      // photo, so there was no title, price or size to read. Enrichment is what
      // was supposed to fill that in — and when the detail page refuses us, it
      // never will.
      //
      // Verified live: Immowelt answers 403 on every /expose/ page, and 31 of
      // 85 discovered ads sat in the pool as permanently empty rows. Leaving
      // them is the "list you have to mentally filter" this tool exists to
      // remove, so an entry that has nothing of its own and cannot be read is
      // retired with an honest reason. The row stays, which is what stops the
      // next sweep from recreating and re-fetching it forever.
      const stillEmpty =
        listing.kaltMieteCents == null &&
        listing.warmMieteCents == null &&
        listing.rooms == null &&
        listing.livingSpaceSqm == null;

      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          lastCheckedAt: new Date(),
          lastCheckStatus: page.blocked ? 'BLOCKED' : 'UNKNOWN',
          lastCheckReason: page.error ?? 'Detailseite nicht lesbar',
          ...(stillEmpty
            ? {
                expired: true,
                expiredAt: new Date(),
                expiredBySystem: true,
                // A distinct marker, because this retirement must survive the
                // ad reappearing in the result list — see upsertDiscovered.
                lastCheckStatus: 'UNREADABLE',
                lastCheckReason: `Keine Angaben lesbar — ${page.error ?? 'Detailseite nicht abrufbar'}`,
              }
            : {}),
        },
      });
      if (stillEmpty) unreadable++;
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

    // Read the detail page and *still* no rent, no rooms, no size?
    //
    // Then it is not an advert. Every real listing states at least one of the
    // three — the whole point of publishing it is to say what it costs or how
    // big it is. What lands here instead is navigation the link-list adapter
    // swept up: a live Gewobag run contributed "Wohnungsangebote finden" and
    // "Wohnen im Alter in Berlin", both of which sail past a wording check
    // because they contain the word "Wohnen".
    //
    // Judging on the absence of every figure catches those without another
    // list of banned phrases to maintain.
    const after = await prisma.listing.findUnique({
      where: { id: listing.id },
      select: { kaltMieteCents: true, warmMieteCents: true, rooms: true, livingSpaceSqm: true },
    });
    const nothingToShow =
      after != null &&
      after.kaltMieteCents == null &&
      after.warmMieteCents == null &&
      after.rooms == null &&
      after.livingSpaceSqm == null;

    if (nothingToShow) {
      await prisma.listing.update({
        where: { id: listing.id },
        data: {
          lastCheckedAt: new Date(),
          expired: true,
          expiredAt: new Date(),
          expiredBySystem: true,
          lastCheckStatus: 'UNREADABLE',
          lastCheckReason: 'Detailseite gelesen, nennt aber weder Miete noch Zimmer noch Fläche',
        },
      });
      unreadable++;
      continue;
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

  return { enriched, unreadable };
}

/* ------------------------------------------------------------ helpers --- */

/**
 * What a successful sweep actually contributed, in one sentence — or null when
 * there is nothing worth saying.
 *
 * A sweep can succeed and still be useless. Immowelt returns thirty-one links
 * every time; every one of them leads to a page rendered by JavaScript that we
 * cannot read, so all thirty-one were retired long ago and are re-found,
 * re-recognised and re-ignored on every pass. The source reported "OK" with no
 * note, which reads as "this is working" on the Quellen page and is the exact
 * shape of the complaint that the tool shows too few flats: it looks healthy
 * and delivers nothing.
 *
 * Saying so does not fix the portal — that needs a rendering fetcher — but it
 * turns an invisible dead end into a visible one, which is the difference
 * between a colleague waiting for results that will never come and a colleague
 * who knows to look elsewhere.
 */
export function describeYield(found: number, unreadable: number): string | null {
  if (found === 0) {
    return 'Suchlauf erfolgreich, aber ohne Treffer — Suchbegriffe oder Ort passen möglicherweise nicht.';
  }
  if (unreadable === 0) return null;
  if (unreadable >= found) {
    return `Alle ${found} Treffer sind bereits als unlesbar aussortiert — diese Quelle liefert nur Platzhalter-Links (Seite wird per JavaScript aufgebaut). Sie trägt derzeit nichts zum Pool bei.`;
  }
  // Below half is ordinary attrition and not worth a warning.
  if (unreadable * 2 < found) return null;
  return `${unreadable} von ${found} Treffern sind unlesbare Platzhalter — von dieser Quelle kommt nur ein Bruchteil an.`;
}

/**
 * Keeps whatever `prepare` had to look up, so the next sweep does not repeat it.
 *
 * Resolving one town costs a page per federal state walked, and with several
 * candidates in several cities that is most of a sweep's request budget spent
 * re-learning the same answers. Only the cache key is written back — never the
 * working copy of `locationIds`, which is per-query and would otherwise be
 * frozen onto the source and handed to the next candidate's city, which is the
 * bug this whole change exists to remove.
 */
async function rememberLookups(
  sourceId: string,
  before: AdapterConfig,
  after: AdapterConfig,
): Promise<void> {
  const learned = after[LOCATION_CACHE_KEY];
  if (!learned) return;
  if (JSON.stringify(learned) === JSON.stringify(before[LOCATION_CACHE_KEY])) return;
  await prisma.source.update({
    where: { id: sourceId },
    data: { discoveryConfig: { ...before, [LOCATION_CACHE_KEY]: learned } as never },
  });
}

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

  // Throttle against the *fastest* source, not a single global interval.
  // Otherwise a Telegram channel set to ten minutes would still only be read
  // every ninety, and the per-source setting would be decoration.
  const fastest = await prisma.source.aggregate({
    where: { active: true, discoveryEnabled: true, pollIntervalMinutes: { not: null } },
    _min: { pollIntervalMinutes: true },
  });
  const throttleMinutes = Math.min(
    settings.sweepIntervalMinutes,
    fastest._min.pollIntervalMinutes ?? settings.sweepIntervalMinutes,
  );

  const last = await prisma.discoveryRun.findFirst({
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  if (last && Date.now() - last.startedAt.getTime() < throttleMinutes * 60_000) {
    return { ...EMPTY, skippedReason: 'Zuletzt vor Kurzem gesucht.' };
  }

  // Not forced: each source's own interval still decides whether it is asked.
  return runDiscoverySweep();
}
