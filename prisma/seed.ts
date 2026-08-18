/**
 * `npm run db:seed`
 *
 * Sets up the demo scenario used by the acceptance test:
 *  - one admin, one colleague,
 *  - the source catalogue,
 *  - one candidate case for a nurse working in Bad Rappenau-Fürfeld,
 *  - a pre-set application message,
 *  - an open search run with all relevant sources,
 *  - eight seeded listings covering the required edge cases.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/auth';
import { syncSeedCatalog } from '../src/server/sources';
import { syncRegionSeeds } from '../src/server/priority';
import { createCandidateCase } from '../src/server/candidates';
import { ingestListing } from '../src/server/listingIngest';
import { createSearchRun, updateSourceCheckStatus } from '../src/server/searchRuns';

const DEMO_ADMIN_EMAIL = 'admin@frese-wohnung.local';
const DEMO_COLLEAGUE_EMAIL = 'kollegin@frese-wohnung.local';

async function upsertUser(email: string, name: string, role: 'ADMIN' | 'COLLEAGUE', password: string) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    create: { email, name, role, passwordHash },
    update: { name, role, passwordHash },
  });
}

const APPLICATION_MESSAGE = `Sehr geehrte Damen und Herren,

wir möchten eine Wohnung für unsere internationale Pflegekraft anmieten, die ab Ende September in Bad Rappenau-Fürfeld ihre Tätigkeit aufnimmt.

Wir treten als gewerblicher Mieter auf und übernehmen alle Vertrags- und Zahlungsverpflichtungen. Die Kollegin wohnt allein und sucht eine ruhige 1- bis 2-Zimmer-Wohnung, gerne möbliert. Ein aktueller Handelsregisterauszug sowie ein Ansprechpartner mit deutscher Telefonnummer stehen selbstverständlich zur Verfügung.

Über eine kurze Rückmeldung, wann eine Besichtigung möglich wäre, freuen wir uns.

Mit freundlichen Grüßen
Team Frese Recruiting GmbH`;

async function seedDemoListings(sourceKeyBy: Map<string, string>, importedById: string, candidateCaseId: string) {
  const listings: Array<Parameters<typeof ingestListing>[0]> = [
    {
      // Mit Telefonnummer im Text — zeigt das „Kontakt vorhanden"-Feld auf der
      // Ergebnisliste. Genau so schreiben private Vermieter ihre Anzeigen.
      sourceId: sourceKeyBy.get('kleinanzeigen')!,
      rawUrl: 'https://www.kleinanzeigen.de/s-anzeige/moebliertes-apartment-fuerfeld/9900110022',
      title: 'Vollmöbliertes 2-Zimmer-Apartment in Bad Rappenau-Fürfeld',
      descriptionRaw:
        'Charmantes vollmöbliertes Apartment in ruhiger Lage in 74906 Bad Rappenau (Fürfeld). ' +
        '55 m², 2 Zimmer, Warmmiete 780,00 €. Ab sofort bezugsfrei. Anmeldung möglich, ' +
        'Wohnungsgeberbestätigung wird ausgestellt. Kaution 1.560 €. Provisionsfrei. ' +
        'Ansprechpartner: Herr Weber, Rückfragen gerne telefonisch unter 07264 / 123456.',
      locationRaw: '74906 Bad Rappenau-Fürfeld',
      locationCity: 'Bad Rappenau',
      locationPostal: '74906',
      importedById,
    },
    {
      sourceId: sourceKeyBy.get('immoscout24')!,
      rawUrl: 'https://www.immobilienscout24.de/expose/153627384?ref=alert',
      title: '3-Zimmer-Wohnung mit EBK — 74906 Bad Rappenau',
      descriptionRaw:
        'Helle 3-Zimmer-Wohnung, 74 m², Etagenwohnung mit Einbauküche. ' +
        'Kaltmiete 690,00 €, Nebenkosten ca. 120,00 €, Heizkosten 60,00 €. ' +
        'Frei ab 01.10.2026. Keine Haustiere.',
      locationRaw: 'Bad Rappenau, Marktstraße',
      locationCity: 'Bad Rappenau',
      locationPostal: '74906',
      importedById,
    },
    {
      sourceId: sourceKeyBy.get('immowelt')!,
      rawUrl: 'https://www.immowelt.de/expose/2abc-fuerfeld-3zi',
      title: '2-Zi-Wohnung Bad Wimpfen — nur Kaltmiete angegeben',
      descriptionRaw:
        'Gemütliche 2-Zimmer-Wohnung in 74206 Bad Wimpfen. 58 m², Kaltmiete 700,00 €. ' +
        'Zusätzliche Kosten laut Angebot. Verfügbar ab 15.10.2026.',
      locationRaw: 'Bad Wimpfen',
      locationCity: 'Bad Wimpfen',
      locationPostal: '74206',
      importedById,
    },
    {
      sourceId: sourceKeyBy.get('kleinanzeigen')!,
      rawUrl: 'https://www.kleinanzeigen.de/s-anzeige/wohnung-mit-moebeluebernahme/1234567890',
      title: '2-Zi Wohnung — Möbelübernahme gegen Ablöse',
      descriptionRaw:
        '2-Zimmer-Wohnung in 74177 Bad Friedrichshall, 54 m². Kaltmiete 620 €, Nebenkosten 150 €. ' +
        'Möbelübernahme möglich — Ablöse 2.500 €. Frei ab 01.11.2026.',
      locationRaw: '74177 Bad Friedrichshall',
      locationCity: 'Bad Friedrichshall',
      locationPostal: '74177',
      importedById,
    },
    {
      sourceId: sourceKeyBy.get('immowelt')!,
      rawUrl: 'https://www.immowelt.de/expose/leg-004-heilbronn',
      title: '2-Zimmer-Wohnung Heilbronn — WBS erforderlich',
      descriptionRaw:
        'Sozial geförderte 2-Zimmer-Wohnung in 74076 Heilbronn. 63 m², Warmmiete 620,00 €. ' +
        'Wohnberechtigungsschein zwingend erforderlich (WBS).',
      locationRaw: 'Heilbronn',
      locationCity: 'Heilbronn',
      locationPostal: '74076',
      importedById,
    },
    {
      sourceId: sourceKeyBy.get('immoscout24')!,
      rawUrl: 'https://www.immobilienscout24.de/expose/998001234',
      title: 'Tauschwohnung: 2 Zi gegen 3 Zi in Heilbronn',
      descriptionRaw:
        'Wohnungstausch — biete Tauschwohnung 2 Zimmer, 55 m², suche 3 Zimmer. Kaltmiete 650 €, ' +
        'Nebenkosten 130 €, Heizung 60 €. Nur Tausch.',
      locationRaw: '74072 Heilbronn',
      locationCity: 'Heilbronn',
      locationPostal: '74072',
      importedById,
    },
    {
      sourceId: sourceKeyBy.get('kleinanzeigen')!,
      rawUrl: 'https://www.kleinanzeigen.de/s-anzeige/1-zimmer-apartment-moebliert/9900110099',
      title: 'Möbliertes 1-Zimmer-Apartment bei Bad Rappenau',
      descriptionRaw:
        'Voll möbliertes 1-Zimmer-Apartment, 34 m², Warmmiete 690 € all-in. ' +
        'Ab sofort frei. Anmeldung möglich. Bitte nur per WhatsApp: 0151 23456789.',
      locationRaw: '74906 Bad Rappenau',
      locationCity: 'Bad Rappenau',
      locationPostal: '74906',
      importedById,
    },
    {
      // Suspected cross-portal duplicate of the Kleinanzeigen one above.
      sourceId: sourceKeyBy.get('immoscout24')!,
      rawUrl: 'https://www.immobilienscout24.de/expose/153000001',
      title: 'Möbliertes 2-Zimmer Apartment Bad Rappenau Fürfeld',
      descriptionRaw:
        'Möbliertes 2-Zimmer-Apartment, 55 m², Warmmiete 780 €, in 74906 Bad Rappenau-Fürfeld. ' +
        'Bezugsfrei ab sofort.',
      locationRaw: '74906 Bad Rappenau-Fürfeld',
      locationCity: 'Bad Rappenau',
      locationPostal: '74906',
      importedById,
    },
  ];

  for (const l of listings) {
    await ingestListing(l);
  }

  // Force a match recompute for the candidate now that all listings exist.
  const { recomputeAllForCandidate } = await import('../src/server/ranking');
  await recomputeAllForCandidate(candidateCaseId);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'demo-admin-pw-2026';
  const admin = await upsertUser(DEMO_ADMIN_EMAIL, 'Demo-Admin', 'ADMIN', adminPassword);
  const colleague = await upsertUser(DEMO_COLLEAGUE_EMAIL, 'Demo-Kollegin', 'COLLEAGUE', adminPassword);

  const catalog = await syncSeedCatalog();
  console.log(
    `Quellen: ${catalog.created} neu, ${catalog.updated} aktualisiert, ${catalog.retired} stillgelegt.`,
  );

  const regions = await syncRegionSeeds();
  console.log(`Markt-Startschätzungen: ${regions} Regionen.`);

  // Idempotency: if the demo candidate already exists, do NOT delete/recreate
  // it. That would wipe any state the user built on top of it after a redeploy.
  // Set SEED_FORCE_RESET=true to wipe and re-seed intentionally.
  const existing = await prisma.candidateCase.findUnique({ where: { reference: 'CAND-DEMO-01' } });
  if (existing && process.env.SEED_FORCE_RESET !== 'true') {
    console.log('Demo-Kandidat existiert bereits — Seed übersprungen (setze SEED_FORCE_RESET=true zum Erzwingen).');
    console.log('\nDemo-Login:');
    console.log(`  Admin:     ${DEMO_ADMIN_EMAIL} / ${adminPassword}`);
    console.log(`  Kollegin:  ${DEMO_COLLEAGUE_EMAIL} / ${adminPassword}`);
    void admin;
    return;
  }
  if (existing) {
    await prisma.candidateCase.delete({ where: { id: existing.id } });
  }

  const candidate = await createCandidateCase({
    reference: 'CAND-DEMO-01',
    displayName: 'Pflegekraft Fürfeld (Demo)',
    createdById: colleague.id,
    // Signed three weeks ago, moving in five weeks from now — a realistic,
    // moderately urgent case for the demo.
    contractSignedAt: daysAgo(24),
    moveInDate: daysAhead(36),
    workplace: {
      address: 'Salinenstraße 2, 74906 Bad Rappenau-Fürfeld',
      city: 'Bad Rappenau',
      postalCode: '74906',
      // Approximate coordinates for Bad Rappenau-Fürfeld. Manual = we did not
      // hit an external geocoder; the profile records geocodeStatus MANUAL.
      lat: 49.238,
      lon: 9.117,
    },
    maxWarmmieteCents: 90000,
    minRooms: 1,
    preferredRooms: 2,
    adults: 1,
    children: 0,
    furnished: 'PREFERRED',
    maxCommuteMinutes: 35,
    radiusKm: 20,
    wbsStatus: 'NOT_AVAILABLE',
    temporaryMode: false,
  });

  await prisma.applicationMessage.update({
    where: { candidateCaseId: candidate.id },
    data: { body: APPLICATION_MESSAGE, updatedById: colleague.id, revision: 1 },
  });

  const run = await createSearchRun(candidate.id, colleague.id, 'Erster Suchlauf');
  console.log(`Suchlauf mit ${run.planned.length} Quellen geplant.`);

  // Mark one source as "checked — no results" to demonstrate the flow.
  const sourceByKey = new Map<string, string>();
  const sources = await prisma.source.findMany();
  for (const s of sources) sourceByKey.set(s.key, s.id);

  const immoweltCheck = await prisma.sourceCheck.findFirst({
    where: { searchRunId: run.runId, source: { key: 'immowelt' } },
  });
  if (immoweltCheck) {
    await updateSourceCheckStatus({
      sourceCheckId: immoweltCheck.id,
      userId: colleague.id,
      status: 'CHECKED_NO_RESULTS',
      note: 'Suchauftrag angelegt, heute noch keine neuen Treffer per Mail.',
    });
  }

  await seedDemoListings(sourceByKey, colleague.id, candidate.id);

  console.log('\nDemo-Login:');
  console.log(`  Admin:     ${DEMO_ADMIN_EMAIL} / ${adminPassword}`);
  console.log(`  Kollegin:  ${DEMO_COLLEAGUE_EMAIL} / ${adminPassword}`);
  console.log('  (aus SEED_ADMIN_PASSWORD; unbedingt anpassen, sobald echte Nutzer angelegt sind).');

  void admin; // silence lint: we already log the email.
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
