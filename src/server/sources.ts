/**
 * Keep the database's source list in step with the catalogue in
 * `domain/sources/catalog.ts`.
 *
 * Safe to run repeatedly — it is called on every deploy. Three rules:
 *
 *  1. Facts about the code (name, route, which adapter can read the source)
 *     come from the catalogue and are refreshed every time.
 *  2. Decisions an admin made (is discovery switched on, what did they
 *     configure) are theirs and are never overwritten.
 *  3. A source that has dropped out of the catalogue is switched off rather
 *     than deleted, unless it never produced a single advert. A listing can
 *     have a conversation hanging off it, and that conversation outlives the
 *     source it came from.
 */

import { prisma } from '@/lib/prisma';
import { SEED_SOURCES } from '@/domain/sources/catalog';

export interface SyncResult {
  created: number;
  updated: number;
  retired: number;
}

export async function syncSeedCatalog(): Promise<SyncResult> {
  let created = 0;
  let updated = 0;

  for (const s of SEED_SOURCES) {
    const existing = await prisma.source.findUnique({ where: { key: s.key } });
    const source = await prisma.source.upsert({
      where: { key: s.key },
      create: {
        key: s.key,
        name: s.name,
        websiteUrl: s.websiteUrl,
        route: s.route,
        priority: s.priority,
        discoveryAdapter: s.discoveryAdapter ?? null,
        manualRecipe: s.manualRecipe ?? null,
        notes: s.notes,
        active: true,
      },
      update: {
        name: s.name,
        websiteUrl: s.websiteUrl,
        route: s.route,
        priority: s.priority,
        // Which adapter *can* read the source is a fact about the code, so the
        // catalogue owns it. Whether it actually runs (discoveryEnabled) and
        // how it is configured stay with the admin.
        discoveryAdapter: s.discoveryAdapter ?? null,
        manualRecipe: s.manualRecipe ?? null,
        notes: s.notes,
        active: true,
      },
    });
    if (existing) updated++;
    else created++;

    // The filter mapping is the catalogue's authoritative view — it is what the
    // per-candidate recipe is generated from, so it gets replaced wholesale.
    await prisma.sourceFilterMapping.deleteMany({ where: { sourceId: source.id } });
    for (const f of s.filters) {
      await prisma.sourceFilterMapping.create({
        data: {
          sourceId: source.id,
          canonicalFilter: f.filter,
          quality: f.quality,
          portalLabel: f.portalLabel ?? null,
          note: f.note ?? null,
        },
      });
    }
  }

  const retired = await retireSourcesNotInCatalog();
  return { created, updated, retired };
}

/**
 * Switch off everything the catalogue no longer lists, and delete the ones that
 * left no trace at all. This is what shrinks a database still carrying the old
 * fifty-source catalogue down to the three that matter.
 *
 * "No trace" means no adverts **and** no search-run tasks. Both tables refuse
 * the delete (`onDelete: Restrict`), and both are right to: an advert can have
 * a conversation hanging off it, and a SourceCheck is a record of a colleague
 * having worked that source on a given day. Checking only the adverts is what
 * made the first production deploy of this throw
 * `violates RESTRICT setting of foreign key constraint "SourceCheck_sourceId_fkey"`
 * — which then took the whole seed step down with it.
 *
 * Anything with a trace is deactivated instead: invisible everywhere in the UI,
 * and its history stays readable.
 */
async function retireSourcesNotInCatalog(): Promise<number> {
  const keep = SEED_SOURCES.map((s) => s.key);

  // Deliberately not `active: true` as the condition. A source that was
  // already switched off before this ever ran would keep `discoveryEnabled`
  // set forever — harmless for the sweep, which filters on `active`, but it
  // makes /api/diagnostics report more working sources than exist, and a
  // number on the "is it working" screen that is wrong is worse than none.
  const { count } = await prisma.source.updateMany({
    where: {
      key: { notIn: keep },
      OR: [{ active: true }, { discoveryEnabled: true }],
    },
    data: {
      active: false,
      discoveryEnabled: false,
      discoveryStatus: 'RETIRED',
      discoveryNote: 'Nicht mehr im Katalog — es gibt nur noch Kleinanzeigen, ImmoScout24 und Immowelt.',
    },
  });

  const withoutTrace = await prisma.source.findMany({
    where: { key: { notIn: keep }, listings: { none: {} }, sourceChecks: { none: {} } },
    select: { id: true },
  });
  if (withoutTrace.length > 0) {
    await prisma.source.deleteMany({ where: { id: { in: withoutTrace.map((s) => s.id) } } });
  }

  return count;
}
