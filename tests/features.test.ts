/**
 * Die Bausteine — und vor allem: dass ein Schalter etwas bewirkt.
 *
 * Ein Ein/Aus-Schalter, der nur ein Kästchen umlegt, ist schlimmer als kein
 * Schalter: er verspricht eine Wirkung, die es nicht gibt. Deshalb prüft die
 * zweite Hälfte hier nicht die Einstellung, sondern das Verhalten dahinter.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import {
  DEFAULT_FEATURES,
  FEATURES,
  featureGroups,
  featuresByGroup,
  isFeatureOn,
} from '@/domain/features';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

describe('die Liste der Bausteine', () => {
  it('hat keine doppelten Schlüssel', () => {
    const keys = FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('erklärt bei jedem, was das Ausschalten kostet', () => {
    // Ein Schalter ohne diesen Satz wird nicht umgelegt, weil niemand weiß,
    // was danach fehlt.
    for (const f of FEATURES) {
      expect(f.label.length, f.key).toBeGreaterThan(3);
      expect(f.description.length, f.key).toBeGreaterThan(20);
      expect(f.offMeans.length, f.key).toBeGreaterThan(20);
    }
  });

  it('ordnet jeden Baustein einer Gruppe zu, die es gibt', () => {
    const groups = new Set(featureGroups());
    for (const f of FEATURES) expect(groups.has(f.group), f.key).toBe(true);
    // Und keine Gruppe ist leer.
    for (const g of groups) expect(featuresByGroup(g).length, g).toBeGreaterThan(0);
  });
});

describe('isFeatureOn', () => {
  it('nimmt den gespeicherten Wert', () => {
    expect(isFeatureOn({ wgMatching: false }, 'wgMatching')).toBe(false);
    expect(isFeatureOn({ telegram: true }, 'telegram')).toBe(true);
  });

  it('fällt auf den Standard zurück, wenn nichts gespeichert ist', () => {
    expect(isFeatureOn({}, 'wgMatching')).toBe(true);
    expect(isFeatureOn({}, 'telegram')).toBe(false);
  });

  it('überlebt eine fehlende oder kaputte Einstellung', () => {
    // Eine unlesbare Zeile darf nie die halbe Oberfläche verschwinden lassen.
    expect(isFeatureOn(null, 'wgMatching')).toBe(true);
    expect(isFeatureOn(undefined, 'wgMatching')).toBe(true);
    expect(isFeatureOn({ wgMatching: 'ja' } as never, 'wgMatching')).toBe(true);
  });

  it('kennt für jeden Baustein einen Standard', () => {
    for (const f of FEATURES) {
      expect(DEFAULT_FEATURES[f.key], f.key).toBe(f.defaultOn);
    }
  });
});

describe('ein Schalter bewirkt etwas', () => {
  async function setFeature(key: string, on: boolean, userId: string) {
    const { writeSetting, SETTING_KEYS, getFeatureSettings } = await import('@/server/settings');
    const current = await getFeatureSettings();
    await writeSetting(SETTING_KEYS.features, { ...current, [key]: on }, userId);
  }

  async function seed() {
    const { hashPassword } = await import('@/lib/auth');
    const user = await prisma.user.create({
      data: {
        email: 'bausteine@test.local',
        name: 'Test',
        role: 'ADMIN',
        passwordHash: await hashPassword('test-pw-1234'),
      },
    });
    const source = await prisma.source.create({
      data: {
        key: 'kleinanzeigen',
        name: 'Kleinanzeigen',
        websiteUrl: 'https://www.kleinanzeigen.de/',
        route: 'DISCOVERY',
      },
    });
    return { user, source };
  }

  const adText =
    '58 m², Kaltmiete 620 €. Bei Interesse bitte anrufen unter 07131 / 445566.';

  it('liest die Telefonnummer, solange der Baustein an ist', async () => {
    const { user, source } = await seed();
    const { ingestListing } = await import('@/server/listingIngest');
    const { listingId } = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.kleinanzeigen.de/s-anzeige/wohnung/900001',
      title: 'Wohnung',
      descriptionRaw: adText,
      importedById: user.id,
    });
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.contactPhone).toBe('+49 7131 445566');
  });

  it('liest sie nicht mehr, wenn er aus ist', async () => {
    const { user, source } = await seed();
    await setFeature('contactExtraction', false, user.id);

    const { ingestListing } = await import('@/server/listingIngest');
    const { listingId } = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.kleinanzeigen.de/s-anzeige/wohnung/900002',
      title: 'Wohnung',
      descriptionRaw: adText,
      importedById: user.id,
    });
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.contactPhone).toBeNull();
  });

  it('verliert eine schon gespeicherte Nummer nicht durch das Ausschalten', async () => {
    // Ein Baustein blendet aus, er löscht nicht.
    const { user, source } = await seed();
    const { ingestListing } = await import('@/server/listingIngest');
    const url = 'https://www.kleinanzeigen.de/s-anzeige/wohnung/900003';

    await ingestListing({
      sourceId: source.id,
      rawUrl: url,
      title: 'Wohnung',
      descriptionRaw: adText,
      importedById: user.id,
    });
    await setFeature('contactExtraction', false, user.id);
    await ingestListing({
      sourceId: source.id,
      rawUrl: url,
      title: 'Wohnung',
      descriptionRaw: adText,
      importedById: user.id,
    });

    const listing = await prisma.listing.findFirstOrThrow({ where: { rawUrl: url } });
    expect(listing.contactPhone).toBe('+49 7131 445566');
  });
});
