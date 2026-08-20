/**
 * Einen Fall endgültig löschen.
 *
 * Das Einzige in dieser App, das sich nicht rückgängig machen lässt — deshalb
 * steht hier, was dabei mitgeht und was nicht. Vor allem das *nicht*: der
 * Protokolleintrag hängt mit `SetNull` am Fall, damit die Notiz „X hat diesen
 * Fall gelöscht" nicht das Erste ist, was eine Löschung mitnimmt.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** Ein Fall mit Profil, einer Anzeige und einem Treffer daran. */
async function seedCase() {
  const { hashPassword } = await import('@/lib/auth');
  const { createCandidateCase } = await import('@/server/candidates');

  const user = await prisma.user.create({
    data: {
      email: 'loeschen@test.local',
      name: 'Admin',
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
  const candidate = await createCandidateCase({
    reference: 'CAND-DEL-01',
    displayName: 'Tanvi Gupta',
    createdById: user.id,
    employer: 'SLK-Kliniken Heilbronn',
    workplace: { address: 'Am Gesundbrunnen 20, 74078 Heilbronn', city: 'Heilbronn', postalCode: '74078' },
    maxWarmmieteCents: 90000,
    minRooms: 1,
    preferredRooms: 2,
  });
  const listing = await prisma.listing.create({
    data: {
      sourceId: source.id,
      canonicalUrl: 'https://www.kleinanzeigen.de/s-anzeige/wohnung/500001',
      rawUrl: 'https://www.kleinanzeigen.de/s-anzeige/wohnung/500001',
      title: 'Wohnung',
      importedById: user.id,
    },
  });
  await prisma.candidateListingMatch.create({
    data: {
      candidateCaseId: candidate.id,
      listingId: listing.id,
      status: 'NEW',
      compatibility: 'COMPATIBLE',
      score: 70,
      reasons: [],
      breakdown: {},
      blockers: [],
    },
  });
  await prisma.auditEvent.create({
    data: {
      userId: user.id,
      candidateCaseId: candidate.id,
      entityType: 'CandidateCase',
      entityId: candidate.id,
      action: 'case.create',
    },
  });

  return { user, candidate, listing };
}

describe('die Hürde vor dem Löschen', () => {
  it('verlangt keinen abgetippten Namen mehr', () => {
    // Der Fehler, der das Löschen monatelang unmöglich machte: verglichen
    // wurde mit `displayName`, und in der Praxis stand dort der Arbeitgeber,
    // während der Name der Person in der Referenz stand. Wer den Namen der
    // Kandidatin eintippte, bekam „stimmt nicht" und kam nie durch.
    //
    // Gelesen statt ausgeführt: eine Server Action außerhalb von Next
    // aufzurufen gibt einen Proxy zurück (siehe serverActions.test.ts).
    const actions = readFileSync(join(process.cwd(), 'src', 'app', 'actions.ts'), 'utf8');
    const fn = actions.slice(actions.indexOf('export async function deleteCandidateAction'));
    const body = fn.slice(0, fn.indexOf('\nexport '));

    expect(body).not.toMatch(/confirmName/);
    // Was wirklich schützt, steht weiterhin drin.
    expect(body).toMatch(/requireAdmin\(\)/);
  });
});

describe('einen Fall löschen', () => {
  it('nimmt Profil und Treffer mit', async () => {
    const { candidate } = await seedCase();
    await prisma.candidateCase.delete({ where: { id: candidate.id } });

    expect(await prisma.candidateCase.findUnique({ where: { id: candidate.id } })).toBeNull();
    expect(await prisma.searchProfile.count({ where: { candidateCaseId: candidate.id } })).toBe(0);
    expect(await prisma.candidateListingMatch.count({ where: { candidateCaseId: candidate.id } })).toBe(0);
  });

  it('lässt die Anzeige selbst stehen — sie gehört anderen Fällen genauso', async () => {
    const { candidate, listing } = await seedCase();
    await prisma.candidateCase.delete({ where: { id: candidate.id } });
    expect(await prisma.listing.findUnique({ where: { id: listing.id } })).not.toBeNull();
  });

  it('behält den Protokolleintrag, ohne Fall daran', async () => {
    // Dass gelöscht wurde, ist selbst eine Tatsache, die nachlesbar bleiben
    // muss. Der Eintrag verliert nur seinen Bezug.
    const { candidate } = await seedCase();
    await prisma.candidateCase.delete({ where: { id: candidate.id } });

    const events = await prisma.auditEvent.findMany({ where: { entityId: candidate.id } });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.candidateCaseId === null)).toBe(true);
  });

  it('archivieren löscht dagegen nichts', async () => {
    // Der Normalfall. Der Fall verschwindet aus der Arbeitsliste und bleibt
    // vollständig nachlesbar.
    const { candidate } = await seedCase();
    await prisma.candidateCase.update({ where: { id: candidate.id }, data: { status: 'ARCHIVED' } });

    expect(await prisma.candidateListingMatch.count({ where: { candidateCaseId: candidate.id } })).toBe(1);
    expect(await prisma.searchProfile.count({ where: { candidateCaseId: candidate.id } })).toBe(1);
  });
});

describe('Arbeitgeber am Suchprofil', () => {
  it('wird beim Anlegen mitgespeichert', async () => {
    const { candidate } = await seedCase();
    const profile = await prisma.searchProfile.findUniqueOrThrow({
      where: { candidateCaseId: candidate.id },
    });
    expect(profile.employer).toBe('SLK-Kliniken Heilbronn');
    // Die Adresse ist der Punkt, um den herum gesucht wird.
    expect(profile.workplaceCity).toBe('Heilbronn');
  });
});
