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
      sourceId: sourceKeyBy.get('wunderflats')!,
      rawUrl: 'https://wunderflats.com/de/listing/74906-fuerfeld/apt-01?utm_source=email',
      title: 'Vollmöbliertes 2-Zimmer-Apartment in Bad Rappenau-Fürfeld',
      descriptionRaw:
        'Charmantes vollmöbliertes Apartment in ruhiger Lage in 74906 Bad Rappenau (Fürfeld). ' +
        '55 m², 2 Zimmer, Warmmiete 780,00 €. Ab sofort bezugsfrei. Anmeldung möglich, ' +
        'Wohnungsgeberbestätigung wird ausgestellt. Kaution 1.560 €. Provisionsfrei.',
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
      sourceId: sourceKeyBy.get('leg')!,
      rawUrl: 'https://www.leg-wohnen.de/mieten/objekt/74076-heilbronn/leg-004',
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
      sourceId: sourceKeyBy.get('housinganywhere')!,
      rawUrl: 'https://housinganywhere.com/en/room/de/heilbronn/apt-fuerfeld-002',
      title: 'Furnished 1-room apartment near Bad Rappenau',
      descriptionRaw:
        'Fully furnished 1-room apartment, 34 m², monthly all-in 690 €. ' +
        'Available now (ab sofort). Anmeldung möglich.',
      locationRaw: '74906 Bad Rappenau',
      locationCity: 'Bad Rappenau',
      locationPostal: '74906',
      importedById,
    },
    {
      // Suspected cross-portal duplicate of the Wunderflats one above.
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

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'demo-admin-pw-2026';
  const admin = await upsertUser(DEMO_ADMIN_EMAIL, 'Demo-Admin', 'ADMIN', adminPassword);
  const colleague = await upsertUser(DEMO_COLLEAGUE_EMAIL, 'Demo-Kollegin', 'COLLEAGUE', adminPassword);

  const { createdSources, updatedSources } = await syncSeedCatalog();
  console.log(`Quellenkatalog: ${createdSources} neu, ${updatedSources} aktualisiert.`);

  // Wipe existing candidate so seeding is deterministic.
  const existing = await prisma.candidateCase.findUnique({ where: { reference: 'CAND-DEMO-01' } });
  if (existing) {
    await prisma.candidateCase.delete({ where: { id: existing.id } });
  }

  const candidate = await createCandidateCase({
    reference: 'CAND-DEMO-01',
    displayName: 'Pflegekraft Fürfeld (Demo)',
    createdById: colleague.id,
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
  console.log(`Suchlauf mit ${run.planned.length} Quellen geplant, ${run.excluded.length} ausgeschlossen.`);

  // Mark one manual source as "checked — no results" to demonstrate the flow.
  const sourceByKey = new Map<string, string>();
  const sources = await prisma.source.findMany();
  for (const s of sources) sourceByKey.set(s.key, s.id);

  const nebenanCheck = await prisma.sourceCheck.findFirst({
    where: { searchRunId: run.runId, source: { key: 'nebenan' } },
  });
  if (nebenanCheck) {
    await updateSourceCheckStatus({
      sourceCheckId: nebenanCheck.id,
      userId: colleague.id,
      status: 'CHECKED_NO_RESULTS',
      note: 'Aktuell keine passenden Nachbarschafts-Aushänge.',
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
