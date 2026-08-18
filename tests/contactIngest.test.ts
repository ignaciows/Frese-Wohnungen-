/**
 * The contact details, from the ad text all the way into the database.
 *
 * The unit tests in contact.test.ts prove the reading. This proves the wiring:
 * that every route into the app fills the fields, and — the part that is easy
 * to get wrong — that a number we once had is never dropped because a later
 * pass of the same ad no longer mentions it.
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
      email: 'kontakt@test.local',
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
      discoveryAdapter: 'kleinanzeigen',
    },
  });
  return { user, source };
}

describe('contact details on an ingested listing', () => {
  it('reads phone, name and address out of the ad text', async () => {
    const { user, source } = await seed();
    const { ingestListing } = await import('@/server/listingIngest');

    const { listingId } = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.kleinanzeigen.de/s-anzeige/wohnung/1000000001',
      title: '2-Zimmer-Wohnung in Heilbronn',
      descriptionRaw:
        '58 m², Kaltmiete 620 €, Nebenkosten 140 €. Frei ab 01.11.2026. ' +
        'Ansprechpartner: Herr Weber. Bitte anrufen unter 07131 / 445566 ' +
        'oder schreiben an weber@example-vermietung.de.',
      importedById: user.id,
    });

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.contactPhone).toBe('+49 7131 445566');
    expect(listing.contactName).toBe('Herr Weber');
    expect(listing.contactEmail).toBe('weber@example-vermietung.de');
  });

  it('leaves the fields empty when the ad only offers a portal form', async () => {
    const { user, source } = await seed();
    const { ingestListing } = await import('@/server/listingIngest');

    const { listingId } = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.kleinanzeigen.de/s-anzeige/wohnung/1000000002',
      title: '3-Zimmer-Wohnung',
      descriptionRaw: '74 m², Warmmiete 900 €. Anfragen bitte ausschließlich über das Kontaktformular.',
      importedById: user.id,
    });

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.contactPhone).toBeNull();
    expect(listing.contactEmail).toBeNull();
  });

  it('never loses a number because a later sweep no longer shows it', async () => {
    // Portals hide the number once an ad gets popular. Losing it would mean
    // losing the only fast route to that landlord.
    const { user, source } = await seed();
    const { ingestListing } = await import('@/server/listingIngest');
    const url = 'https://www.kleinanzeigen.de/s-anzeige/wohnung/1000000003';

    await ingestListing({
      sourceId: source.id,
      rawUrl: url,
      title: 'Nachmieter gesucht',
      descriptionRaw: '55 m², 700 € warm. Tel. 0176 12345678.',
      importedById: user.id,
    });
    await ingestListing({
      sourceId: source.id,
      rawUrl: url,
      title: 'Nachmieter gesucht',
      descriptionRaw: '55 m², 700 € warm. Anfragen über das Portal.',
      importedById: user.id,
    });

    const listing = await prisma.listing.findFirstOrThrow({ where: { rawUrl: url } });
    expect(listing.contactPhone).toBe('+49 176 12345678');
  });

  it('lets the source override what the text says', async () => {
    // Kleinanzeigen names the seller in its own markup. That beats guessing
    // from prose.
    const { user, source } = await seed();
    const { ingestListing } = await import('@/server/listingIngest');

    const { listingId } = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.kleinanzeigen.de/s-anzeige/wohnung/1000000004',
      title: 'Wohnung',
      descriptionRaw: 'Kontakt Herr Meier, 0176 12345678.',
      contactName: 'Hausverwaltung Nord GmbH',
      importedById: user.id,
    });

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.contactName).toBe('Hausverwaltung Nord GmbH');
    expect(listing.contactPhone).toBe('+49 176 12345678');
  });
});
