/**
 * End-to-end workflow test hitting the real Postgres test database.
 *
 * Covers the acceptance scenario:
 *  - candidate + profile + message,
 *  - search run plans a task for each of the three sources,
 *  - manual "checked - no results" recorded with user + time,
 *  - listing ingest runs parser + ranking,
 *  - open != contacted,
 *  - explicit confirm stores message snapshot,
 *  - same-candidate duplicate contact blocked,
 *  - three-field system-transfer payload,
 *  - editing a source mapping does NOT rewrite historical run snapshot.
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

async function seedBaseline() {
  const { hashPassword } = await import('@/lib/auth');
  const { syncSeedCatalog } = await import('@/server/sources');
  const { createCandidateCase } = await import('@/server/candidates');
  const passwordHash = await hashPassword('test-pw-1234');
  const admin = await prisma.user.create({
    data: { email: 'admin@test.local', name: 'Admin', role: 'ADMIN', passwordHash },
  });
  const colleague = await prisma.user.create({
    data: { email: 'kol@test.local', name: 'Kollegin', role: 'COLLEAGUE', passwordHash },
  });
  await syncSeedCatalog();
  const candidate = await createCandidateCase({
    reference: 'CAND-TEST-01',
    displayName: 'Testkandidatin',
    createdById: colleague.id,
    workplace: {
      address: 'Salinenstr. 2, 74906 Bad Rappenau-Fürfeld',
      city: 'Bad Rappenau',
      postalCode: '74906',
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
    data: { body: 'Sehr geehrte Damen und Herren, [Anschreiben]…', updatedById: colleague.id },
  });
  return { admin, colleague, candidate };
}

describe('search run planning', () => {
  it('plans one task per source — the three, and only the three', async () => {
    const { colleague, candidate } = await seedBaseline();
    const { createSearchRun } = await import('@/server/searchRuns');
    const run = await createSearchRun(candidate.id, colleague.id);
    expect(run.planned.map((p) => p.sourceKey).sort()).toEqual([
      'immoscout24',
      'immowelt',
      'kleinanzeigen',
    ]);
    expect(run.skipped).toEqual([]);
  });

  it('gives each task a recipe the colleague can actually follow', async () => {
    const { colleague, candidate } = await seedBaseline();
    const { createSearchRun } = await import('@/server/searchRuns');
    const run = await createSearchRun(candidate.id, colleague.id);
    for (const task of run.planned) {
      expect(task.recipeSnapshot.lines.length, task.sourceKey).toBeGreaterThan(0);
    }
  });

  it('records CHECKED_NO_RESULTS with user and time', async () => {
    const { colleague, candidate } = await seedBaseline();
    const { createSearchRun, updateSourceCheckStatus } = await import('@/server/searchRuns');
    const run = await createSearchRun(candidate.id, colleague.id);
    const anyCheck = await prisma.sourceCheck.findFirstOrThrow({ where: { searchRunId: run.runId } });
    const before = new Date();
    await updateSourceCheckStatus({
      sourceCheckId: anyCheck.id,
      userId: colleague.id,
      status: 'CHECKED_NO_RESULTS',
      note: 'Nichts passendes',
    });
    const after = await prisma.sourceCheck.findUniqueOrThrow({ where: { id: anyCheck.id } });
    expect(after.status).toBe('CHECKED_NO_RESULTS');
    expect(after.checkedById).toBe(colleague.id);
    expect(after.lastCheckedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('editing a source mapping later does not rewrite the run snapshot', async () => {
    const { colleague, candidate } = await seedBaseline();
    const { createSearchRun } = await import('@/server/searchRuns');
    const run = await createSearchRun(candidate.id, colleague.id);
    const checkBefore = await prisma.sourceCheck.findFirstOrThrow({
      where: { searchRunId: run.runId },
      include: { source: { include: { filterMappings: true } } },
    });
    const snapshotBefore = JSON.parse(JSON.stringify(checkBefore.mappingSnapshot));

    // Change one mapping directly.
    const mapping = checkBefore.source.filterMappings[0];
    await prisma.sourceFilterMapping.update({
      where: { id: mapping.id },
      data: { quality: 'UNSUPPORTED', note: 'jetzt geändert' },
    });

    const checkAfter = await prisma.sourceCheck.findUniqueOrThrow({ where: { id: checkBefore.id } });
    expect(checkAfter.mappingSnapshot).toEqual(snapshotBefore);
  });
});

describe('listing ingest + ranking', () => {
  it('ingests a listing, extracts facts, and creates a candidate match', async () => {
    const { colleague, candidate } = await seedBaseline();
    const source = await prisma.source.findFirstOrThrow({ where: { key: 'immoscout24' } });
    const { ingestListing } = await import('@/server/listingIngest');
    const result = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.immobilienscout24.de/expose/1000000001?utm_source=x',
      title: 'Vollmöbliertes 2-Zimmer-Apartment Bad Rappenau',
      descriptionRaw: 'Warmmiete 780,00 € — vollmöbliert. 55 m², 2 Zimmer, ab sofort bezugsfrei.',
      locationRaw: '74906 Bad Rappenau',
      locationCity: 'Bad Rappenau',
      locationPostal: '74906',
      importedById: colleague.id,
    });
    expect(result.facts.furnishing).toBe('FULLY_FURNISHED');
    const match = await prisma.candidateListingMatch.findUniqueOrThrow({
      where: { candidateCaseId_listingId: { candidateCaseId: candidate.id, listingId: result.listingId } },
    });
    expect(['COMPATIBLE', 'NEAR_MATCH']).toContain(match.compatibility);
    expect(match.score).toBeGreaterThan(50);
  });

  it('re-ingesting the same canonical URL is idempotent', async () => {
    const { colleague } = await seedBaseline();
    const source = await prisma.source.findFirstOrThrow({ where: { key: 'immoscout24' } });
    const { ingestListing } = await import('@/server/listingIngest');
    const a = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.immobilienscout24.de/expose/1000000002?ref=x',
      title: 'Apartment A',
      descriptionRaw: 'Warmmiete 800 €. Möbliert.',
      importedById: colleague.id,
    });
    const b = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.immobilienscout24.de/expose/1000000002?utm_source=x',
      title: 'Apartment A',
      descriptionRaw: 'Warmmiete 800 €. Möbliert.',
      importedById: colleague.id,
    });
    expect(a.listingId).toBe(b.listingId);
  });

  it('keeps a move-in date entered by hand when the advert is swept again', async () => {
    // The colleague rings the landlord and learns the flat is free from 1.10.
    // The advert still says nothing, and will keep saying nothing on every
    // sweep from now on. Nothing must not overwrite something.
    const { colleague } = await seedBaseline();
    const source = await prisma.source.findFirstOrThrow({ where: { key: 'immoscout24' } });
    const { ingestListing } = await import('@/server/listingIngest');
    const advert = {
      sourceId: source.id,
      rawUrl: 'https://www.immobilienscout24.de/expose/1000000003',
      title: 'Wohnung ohne Datum',
      descriptionRaw: 'Warmmiete 800 €. Kein Einzugstermin genannt.',
      importedById: colleague.id,
    };
    const first = await ingestListing(advert);
    expect((await prisma.listing.findUniqueOrThrow({ where: { id: first.listingId } })).availableFrom).toBeNull();

    const byHand = new Date('2026-10-01T12:00:00');
    await prisma.listing.update({
      where: { id: first.listingId },
      data: { availableFrom: byHand },
    });
    await prisma.listingFact.create({
      data: {
        listingId: first.listingId,
        key: 'availableFrom',
        valueJson: byHand.toISOString(),
        origin: 'MANUAL',
        confidence: 1,
        isOverride: true,
        createdById: colleague.id,
      },
    });

    await ingestListing(advert);
    const after = await prisma.listing.findUniqueOrThrow({ where: { id: first.listingId } });
    expect(after.availableFrom?.toISOString()).toBe(byHand.toISOString());
  });
});

describe('contact workflow', () => {
  it('claiming a listing does NOT count as contact', async () => {
    const { colleague, candidate } = await seedBaseline();
    const source = await prisma.source.findFirstOrThrow({ where: { key: 'immoscout24' } });
    const { ingestListing } = await import('@/server/listingIngest');
    const { claimListing } = await import('@/server/contact');
    const listing = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.immobilienscout24.de/expose/2000000001',
      title: 'Apartment',
      descriptionRaw: 'Warmmiete 800 €. Möbliert.',
      importedById: colleague.id,
    });
    await claimListing({ candidateCaseId: candidate.id, listingId: listing.listingId, userId: colleague.id });
    const attempts = await prisma.contactAttempt.count({ where: { listingId: listing.listingId } });
    expect(attempts).toBe(0);
    const match = await prisma.candidateListingMatch.findUniqueOrThrow({
      where: { candidateCaseId_listingId: { candidateCaseId: candidate.id, listingId: listing.listingId } },
    });
    expect(match.status).toBe('IN_PROGRESS');
  });

  it('confirmContact snapshots the exact message and creates a SystemTransfer', async () => {
    const { colleague, candidate } = await seedBaseline();
    const source = await prisma.source.findFirstOrThrow({ where: { key: 'immoscout24' } });
    const { ingestListing } = await import('@/server/listingIngest');
    const { confirmContact, formatSystemTransferPayload } = await import('@/server/contact');
    const listing = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.immobilienscout24.de/expose/3000000001',
      title: 'Apartment X',
      descriptionRaw: 'Warmmiete 800 €. Möbliert.',
      locationCity: 'Bad Rappenau',
      locationPostal: '74906',
      importedById: colleague.id,
    });
    const r = await confirmContact({
      candidateCaseId: candidate.id,
      listingId: listing.listingId,
      userId: colleague.id,
    });
    expect(r.ok).toBe(true);
    const attempt = await prisma.contactAttempt.findFirstOrThrow({
      where: { listingId: listing.listingId, candidateCaseId: candidate.id },
      include: { systemTransfer: true },
    });
    expect(attempt.messageSnapshot).toContain('[Anschreiben]');
    expect(attempt.systemTransfer?.objectLabel).toBe('Apartment X');
    const payload = formatSystemTransferPayload(attempt.systemTransfer!);
    expect(payload.fields.map((f) => f.label)).toEqual(['Wohnung/Objekt', 'Link', 'Ort']);
    expect(payload.combined).toContain('Wohnung/Objekt: Apartment X');
    expect(payload.combined).toContain('Ort: 74906, Bad Rappenau');
  });

  it('blocks a second contact for the same candidate + listing', async () => {
    const { colleague, candidate } = await seedBaseline();
    const source = await prisma.source.findFirstOrThrow({ where: { key: 'immoscout24' } });
    const { ingestListing } = await import('@/server/listingIngest');
    const { confirmContact } = await import('@/server/contact');
    const listing = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.immobilienscout24.de/expose/4000000001',
      title: 'Apartment Y',
      descriptionRaw: 'Warmmiete 800 €. Möbliert.',
      importedById: colleague.id,
    });
    const first = await confirmContact({ candidateCaseId: candidate.id, listingId: listing.listingId, userId: colleague.id });
    expect(first.ok).toBe(true);
    const second = await confirmContact({ candidateCaseId: candidate.id, listingId: listing.listingId, userId: colleague.id });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('ALREADY_CONTACTED_SAME_CANDIDATE');
  });

  it('warns loudly on cross-candidate duplicate contact but allows override', async () => {
    const { colleague, candidate } = await seedBaseline();
    const { createCandidateCase } = await import('@/server/candidates');
    const other = await createCandidateCase({
      reference: 'CAND-TEST-02',
      displayName: 'Zweite Kandidatin',
      createdById: colleague.id,
      workplace: { address: 'Musterstr 1' },
    });
    await prisma.applicationMessage.update({
      where: { candidateCaseId: other.id },
      data: { body: 'Anschreiben 2', updatedById: colleague.id },
    });

    const source = await prisma.source.findFirstOrThrow({ where: { key: 'immoscout24' } });
    const { ingestListing } = await import('@/server/listingIngest');
    const { confirmContact } = await import('@/server/contact');
    const listing = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.immobilienscout24.de/expose/5000000001',
      title: 'Apartment Z',
      descriptionRaw: 'Warmmiete 800 €.',
      importedById: colleague.id,
    });
    await confirmContact({ candidateCaseId: candidate.id, listingId: listing.listingId, userId: colleague.id });
    const cross = await confirmContact({ candidateCaseId: other.id, listingId: listing.listingId, userId: colleague.id });
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.reason).toBe('ALREADY_CONTACTED_OTHER_CANDIDATE');
    const forced = await confirmContact({
      candidateCaseId: other.id,
      listingId: listing.listingId,
      userId: colleague.id,
      overrideReason: 'Andere Wohnung verwechselt',
    });
    expect(forced.ok).toBe(true);
  });
});

describe('system transfer + audit', () => {
  it('registered mark records user and time', async () => {
    const { colleague, candidate } = await seedBaseline();
    const source = await prisma.source.findFirstOrThrow({ where: { key: 'immoscout24' } });
    const { ingestListing } = await import('@/server/listingIngest');
    const { confirmContact } = await import('@/server/contact');
    const { markSystemTransferRegistered } = await import('@/server/systemTransfer');
    const listing = await ingestListing({
      sourceId: source.id,
      rawUrl: 'https://www.immobilienscout24.de/expose/6000000001',
      title: 'Apt',
      descriptionRaw: 'Warmmiete 800 €.',
      importedById: colleague.id,
    });
    const r = await confirmContact({ candidateCaseId: candidate.id, listingId: listing.listingId, userId: colleague.id });
    if (!r.ok) throw new Error('contact should succeed');
    await markSystemTransferRegistered({ contactAttemptId: r.contactAttemptId, userId: colleague.id });
    const t = await prisma.systemTransfer.findUniqueOrThrow({ where: { contactAttemptId: r.contactAttemptId } });
    expect(t.registeredAt).not.toBeNull();
    expect(t.registeredById).toBe(colleague.id);
  });
});
