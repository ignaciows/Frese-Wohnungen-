/**
 * Sync the seed catalogue into the database. Safe to run repeatedly; existing
 * sources keyed by `key` are updated in place, and admin-created sources are
 * left untouched.
 */

import { prisma } from '@/lib/prisma';
import { SEED_FAMILIES, SEED_SOURCES } from '@/domain/sources/catalog';

export async function syncSeedCatalog(): Promise<{ createdSources: number; updatedSources: number }> {
  const familyIdByKey = new Map<string, string>();
  for (const f of SEED_FAMILIES) {
    const family = await prisma.sourceFamily.upsert({
      where: { key: f.key },
      create: { key: f.key, name: f.name, notes: f.notes ?? null },
      update: { name: f.name, notes: f.notes ?? null },
    });
    familyIdByKey.set(f.key, family.id);
  }

  let created = 0;
  let updated = 0;
  for (const s of SEED_SOURCES) {
    const familyId = s.familyKey ? familyIdByKey.get(s.familyKey) ?? null : null;
    const existing = await prisma.source.findUnique({ where: { key: s.key } });
    const upserted = await prisma.source.upsert({
      where: { key: s.key },
      create: {
        key: s.key,
        name: s.name,
        websiteUrl: s.websiteUrl,
        familyId,
        category: s.category,
        priority: s.priority,
        integrationMode: s.integrationMode,
        discoveryAdapter: s.discoveryAdapter ?? null,
        termsReviewStatus: 'MANUAL_ONLY',
        housingTypes: s.housingTypes,
        temporaryOnly: s.temporaryOnly ?? false,
        manualRecipe: s.manualRecipe ?? null,
        notes: s.notes ?? null,
      },
      update: {
        name: s.name,
        websiteUrl: s.websiteUrl,
        familyId,
        category: s.category,
        priority: s.priority,
        integrationMode: s.integrationMode,
        // Which adapter *can* read the source is a fact about the code, so the
        // catalogue owns it. Whether it actually runs (discoveryEnabled) and
        // how it is configured stay with the admin and are never overwritten.
        discoveryAdapter: s.discoveryAdapter ?? null,
        housingTypes: s.housingTypes,
        temporaryOnly: s.temporaryOnly ?? false,
        manualRecipe: s.manualRecipe ?? null,
        notes: s.notes ?? null,
      },
    });
    if (existing) updated++;
    else created++;

    // A shipped configuration fills a blank, and only a blank. Whatever an
    // admin typed — or the adapter worked out for itself, like Kleinanzeigen's
    // resolved town numbers — is theirs, and overwriting it on every deploy
    // would silently undo their work.
    const configured = (upserted.discoveryConfig ?? {}) as Record<string, unknown>;
    if (s.discoveryConfig && Object.keys(configured).length === 0) {
      await prisma.source.update({
        where: { id: upserted.id },
        data: { discoveryConfig: s.discoveryConfig as never },
      });
    }

    // Replace coverage / mappings / aliases with the seed's authoritative view.
    await prisma.sourceCoverage.deleteMany({ where: { sourceId: upserted.id } });
    for (const c of s.coverage) {
      await prisma.sourceCoverage.create({
        data: { sourceId: upserted.id, kind: c.kind, value: c.value },
      });
    }
    await prisma.sourceFilterMapping.deleteMany({ where: { sourceId: upserted.id } });
    for (const m of s.filterMappings) {
      await prisma.sourceFilterMapping.create({
        data: {
          sourceId: upserted.id,
          canonicalFilter: m.canonicalFilter,
          quality: m.quality,
          portalLabel: m.portalLabel ?? null,
          note: m.note ?? null,
        },
      });
    }
    await prisma.sourceAlias.deleteMany({ where: { sourceId: upserted.id } });
    for (const alias of s.aliases ?? []) {
      await prisma.sourceAlias.create({
        data: { sourceId: upserted.id, name: alias },
      });
    }
  }

  return { createdSources: created, updatedSources: updated };
}
