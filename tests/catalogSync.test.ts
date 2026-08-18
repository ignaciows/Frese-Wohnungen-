/**
 * Den Katalog auf drei Quellen zusammenschrumpfen, ohne etwas kaputtzumachen.
 *
 * Der erste Produktiv-Deploy hiervon ist genau hier gescheitert: „lösche jede
 * Quelle ohne Anzeigen" übersieht, dass auch `SourceCheck` auf `Source` zeigt
 * — mit ON DELETE RESTRICT. In der Entwicklungsdatenbank gab es keine
 * Suchlauf-Aufgaben, in der echten schon, und der Seed-Schritt starb mit
 * `violates RESTRICT setting of foreign key constraint`.
 *
 * Deshalb steht hier eine Datenbank mit Spuren drin, nicht eine leere.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import { syncSeedCatalog } from '@/server/sources';
import { MAIN_SOURCE_KEYS } from '@/domain/sources/catalog';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

/** Ein Nutzer, plus eine alte Quelle mit oder ohne Spuren. */
async function seedLegacySource(opts: { withListing?: boolean; withCheck?: boolean } = {}) {
  const { hashPassword } = await import('@/lib/auth');
  const user = await prisma.user.create({
    data: {
      email: 'sync@test.local',
      name: 'Test',
      role: 'ADMIN',
      passwordHash: await hashPassword('test-pw-1234'),
    },
  });
  const legacy = await prisma.source.create({
    data: { key: 'wg-gesucht', name: 'WG-Gesucht', websiteUrl: 'https://www.wg-gesucht.de/' },
  });

  if (opts.withListing) {
    await prisma.listing.create({
      data: {
        sourceId: legacy.id,
        canonicalUrl: 'https://www.wg-gesucht.de/1.html',
        rawUrl: 'https://www.wg-gesucht.de/1.html',
        title: 'Alte Anzeige',
        importedById: user.id,
      },
    });
  }

  if (opts.withCheck) {
    const candidate = await prisma.candidateCase.create({
      data: { reference: 'CAND-SYNC-01', displayName: 'Testkandidatin', createdById: user.id },
    });
    const run = await prisma.searchRun.create({
      data: { candidateCaseId: candidate.id, createdById: user.id, label: 'Lauf', profileSnapshot: {} },
    });
    await prisma.sourceCheck.create({
      data: {
        searchRunId: run.id,
        sourceId: legacy.id,
        status: 'PENDING',
        mappingSnapshot: {},
        recipeSnapshot: {},
      },
    });
  }

  return { legacy };
}

describe('syncSeedCatalog', () => {
  it('legt genau die drei Quellen an', async () => {
    await seedLegacySource();
    await syncSeedCatalog();
    const active = await prisma.source.findMany({ where: { active: true }, select: { key: true } });
    expect(active.map((s) => s.key).sort()).toEqual([...MAIN_SOURCE_KEYS].sort());
  });

  it('löscht eine alte Quelle, die nie etwas hinterlassen hat', async () => {
    await seedLegacySource();
    await syncSeedCatalog();
    expect(await prisma.source.findUnique({ where: { key: 'wg-gesucht' } })).toBeNull();
  });

  it('behält eine Quelle mit Anzeigen — an einer kann ein Gespräch hängen', async () => {
    await seedLegacySource({ withListing: true });
    await syncSeedCatalog();
    const kept = await prisma.source.findUnique({ where: { key: 'wg-gesucht' } });
    expect(kept?.active).toBe(false);
    expect(kept?.discoveryEnabled).toBe(false);
  });

  it('behält eine Quelle mit Suchlauf-Aufgaben, statt am Fremdschlüssel zu scheitern', async () => {
    // Der eigentliche Produktionsfehler: SourceCheck zeigt mit RESTRICT auf
    // Source, und die Aufgabe ist die Notiz, dass jemand diese Quelle
    // abgearbeitet hat.
    await seedLegacySource({ withCheck: true });
    await expect(syncSeedCatalog()).resolves.toBeDefined();
    const kept = await prisma.source.findUnique({ where: { key: 'wg-gesucht' } });
    expect(kept?.active).toBe(false);
  });

  it('ist wiederholbar — sie läuft bei jedem Deploy', async () => {
    await seedLegacySource({ withCheck: true });
    await syncSeedCatalog();
    await syncSeedCatalog();
    const active = await prisma.source.findMany({ where: { active: true } });
    expect(active).toHaveLength(3);
  });

  it('räumt auch bei einer längst deaktivierten Quelle den Suchlauf-Schalter ab', async () => {
    // Sonst zählt /api/diagnostics sie weiter als „aktive Quelle" mit, obwohl
    // der Suchlauf sie (er filtert auf `active`) nie anfasst.
    const { legacy } = await seedLegacySource({ withListing: true });
    await prisma.source.update({
      where: { id: legacy.id },
      data: { active: false, discoveryEnabled: true },
    });
    await syncSeedCatalog();
    const after = await prisma.source.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(after.discoveryEnabled).toBe(false);
  });

  it('schaltet den Suchlauf bei den Mail-Portalen ab — dort gibt es nichts zu suchen', async () => {
    await syncSeedCatalog();
    await prisma.source.update({
      where: { key: 'immowelt' },
      data: { discoveryEnabled: true },
    });
    await syncSeedCatalog();
    const immowelt = await prisma.source.findUniqueOrThrow({ where: { key: 'immowelt' } });
    expect(immowelt.discoveryEnabled).toBe(false);
    // Kleinanzeigen entscheidet weiterhin der Admin.
    await prisma.source.update({ where: { key: 'kleinanzeigen' }, data: { discoveryEnabled: true } });
    await syncSeedCatalog();
    const ka = await prisma.source.findUniqueOrThrow({ where: { key: 'kleinanzeigen' } });
    expect(ka.discoveryEnabled).toBe(true);
  });

  it('setzt den Weg je Quelle: Kleinanzeigen läuft, die anderen zwei kommen per Mail', async () => {
    await syncSeedCatalog();
    const byKey = new Map(
      (await prisma.source.findMany({ select: { key: true, route: true } })).map((s) => [s.key, s.route]),
    );
    expect(byKey.get('kleinanzeigen')).toBe('DISCOVERY');
    expect(byKey.get('immoscout24')).toBe('EMAIL_ALERT');
    expect(byKey.get('immowelt')).toBe('EMAIL_ALERT');
  });
});
