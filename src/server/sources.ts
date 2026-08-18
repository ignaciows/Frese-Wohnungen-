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
 * never produced an advert. This is what shrinks a database that still carries
 * the old fifty-source catalogue down to the three that matter.
 */
async function retireSourcesNotInCatalog(): Promise<number> {
  const keep = SEED_SOURCES.map((s) => s.key);

  const { count } = await prisma.source.updateMany({
    where: { key: { notIn: keep }, active: true },
    data: {
      active: false,
      discoveryEnabled: false,
      discoveryStatus: 'RETIRED',
      discoveryNote: 'Nicht mehr im Katalog — es gibt nur noch Kleinanzeigen, ImmoScout24 und Immowelt.',
    },
  });

  const emptyOnes = await prisma.source.findMany({
    where: { key: { notIn: keep }, listings: { none: {} } },
    select: { id: true },
  });
  if (emptyOnes.length > 0) {
    await prisma.source.deleteMany({ where: { id: { in: emptyOnes.map((s) => s.id) } } });
  }

  return count;
}
