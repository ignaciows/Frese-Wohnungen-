/**
 * Telefonnummern aus dem Bestand nachlesen.
 *
 * Der Fehler, den das behebt, sah aus wie eine kaputte Funktion: kein einziger
 * „Anrufen"-Knopf im ganzen System, obwohl die Erkennung nachweislich
 * funktioniert. Die Anzeigen waren schlicht importiert worden, bevor es sie
 * gab — und eine Anzeige lässt ihre Detailseite nur einmal lesen.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

async function seed() {
  const { hashPassword } = await import('@/lib/auth');
  const user = await prisma.user.create({
    data: {
      email: 'nachlesen@test.local',
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

  let n = 0;
  const add = (patch: Record<string, unknown>) => {
    n += 1;
    return prisma.listing.create({
      data: {
        sourceId: source.id,
        importedById: user.id,
        canonicalUrl: `https://www.kleinanzeigen.de/s-anzeige/alt/${n}`,
        rawUrl: `https://www.kleinanzeigen.de/s-anzeige/alt/${n}`,
        title: `Wohnung ${n}`,
        ...patch,
      },
    });
  };
  return { add };
}

describe('Kontaktdaten nachlesen', () => {
  it('findet die Nummer im schon gespeicherten Anzeigentext', async () => {
    const { add } = await seed();
    const l = await add({
      descriptionRaw: '58 m², Kaltmiete 620 €. Bei Interesse bitte anrufen unter 07131 / 445566.',
    });

    const { backfillContacts } = await import('@/server/contactBackfill');
    const result = await backfillContacts();
    expect(result.scanned).toBe(1);
    expect(result.phonesFound).toBe(1);
    expect(result.remaining).toBe(0);

    const after = await prisma.listing.findUniqueOrThrow({ where: { id: l.id } });
    expect(after.contactPhone).toBe('+49 7131 445566');
    expect(after.contactScannedAt).not.toBeNull();
  });

  it('fasst dieselbe Anzeige kein zweites Mal an', async () => {
    // Sonst durchsucht jeder Durchlauf für immer den ganzen Bestand.
    const { add } = await seed();
    await add({ descriptionRaw: 'Ohne Nummer im Text.' });

    const { backfillContacts } = await import('@/server/contactBackfill');
    expect((await backfillContacts()).scanned).toBe(1);
    expect((await backfillContacts()).scanned).toBe(0);
  });

  it('überschreibt eine von Hand eingetragene Nummer nicht', async () => {
    const { add } = await seed();
    const l = await add({
      descriptionRaw: 'Rufen Sie an: 07131 / 445566.',
      contactPhone: '+49 160 0000000',
    });

    const { backfillContacts } = await import('@/server/contactBackfill');
    const result = await backfillContacts();

    const after = await prisma.listing.findUniqueOrThrow({ where: { id: l.id } });
    expect(after.contactPhone).toBe('+49 160 0000000');
    // Gezählt wird nur, was wirklich dazukam.
    expect(result.phonesFound).toBe(0);
  });

  it('arbeitet in Häppchen und sagt, wie viel noch offen ist', async () => {
    const { add } = await seed();
    for (let i = 0; i < 5; i++) await add({ descriptionRaw: 'Tel. 07131 445566' });

    const { backfillContacts } = await import('@/server/contactBackfill');
    const first = await backfillContacts(2);
    expect(first.scanned).toBe(2);
    expect(first.remaining).toBe(3);
  });
});
