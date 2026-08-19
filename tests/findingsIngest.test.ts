/**
 * Die Meldungen nach einem Suchlauf, an echten Datensätzen.
 *
 * Der Teil, den nur eine Datenbank zeigt: dass „neu" wirklich neu heißt.
 * Gezählt wird über `matchedAt` — wann ein Treffer für diesen Fall entstanden
 * ist — und nicht über das Alter der Anzeige. Sonst meldet jeder Suchlauf
 * denselben Bestand noch einmal, und nach drei Tagen klickt niemand mehr hin.
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

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

async function seed() {
  const { hashPassword } = await import('@/lib/auth');
  const { createCandidateCase } = await import('@/server/candidates');

  const user = await prisma.user.create({
    data: {
      email: 'meldungen@test.local',
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
  const candidate = await createCandidateCase({
    reference: 'CAND-MELD-01',
    displayName: 'Testkandidatin',
    createdById: user.id,
    workplace: { address: 'Salinenstr. 2, 74906 Bad Rappenau', city: 'Bad Rappenau', postalCode: '74906' },
    maxWarmmieteCents: 90000,
    minRooms: 1,
    preferredRooms: 2,
  });

  let n = 0;
  const addMatch = async (opts: { matchedMinutesAgo: number; phone?: boolean }) => {
    n += 1;
    const listing = await prisma.listing.create({
      data: {
        sourceId: source.id,
        importedById: user.id,
        canonicalUrl: `https://www.kleinanzeigen.de/s-anzeige/meld/${n}`,
        rawUrl: `https://www.kleinanzeigen.de/s-anzeige/meld/${n}`,
        title: `Wohnung ${n}`,
        ...(opts.phone ? { contactPhone: '+49 7131 445566' } : {}),
      },
    });
    await prisma.candidateListingMatch.create({
      data: {
        candidateCaseId: candidate.id,
        listingId: listing.id,
        status: 'NEW',
        compatibility: 'COMPATIBLE',
        score: 80,
        reasons: [],
        breakdown: {},
        blockers: [],
        matchedAt: minutesAgo(opts.matchedMinutesAgo),
      },
    });
  };

  return { candidate, addMatch };
}

describe('Meldungen aus einem Suchlauf', () => {
  it('meldet, was in diesem Lauf dazugekommen ist', async () => {
    const { candidate, addMatch } = await seed();
    await addMatch({ matchedMinutesAgo: 2 });
    await addMatch({ matchedMinutesAgo: 1, phone: true });

    const { notifyNewFindings } = await import('@/server/findings');
    expect(await notifyNewFindings(minutesAgo(10))).toBe(1);

    const notice = await prisma.notification.findFirstOrThrow();
    expect(notice.kind).toBe('DISCOVERY_RESULT');
    expect(notice.candidateCaseId).toBe(candidate.id);
    expect(notice.title).toMatch(/1 Wohnung zum Anrufen/);
    expect(notice.body).toMatch(/2 neue passende Wohnungen/);
  });

  it('meldet den Bestand von gestern kein zweites Mal', async () => {
    // Der Fehler, der die Meldungen wertlos machen würde: jeder Lauf meldet
    // alles, was da ist, und nach drei Tagen klickt niemand mehr hin.
    const { addMatch } = await seed();
    await addMatch({ matchedMinutesAgo: 5000 });

    const { notifyNewFindings } = await import('@/server/findings');
    expect(await notifyNewFindings(minutesAgo(10))).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('schweigt über einen Lauf ohne passende Treffer', async () => {
    await seed();
    const { notifyNewFindings } = await import('@/server/findings');
    expect(await notifyNewFindings(minutesAgo(10))).toBe(0);
  });

  it('meldet nichts für einen Fall, der schon eine Wohnung hat', async () => {
    const { candidate, addMatch } = await seed();
    await addMatch({ matchedMinutesAgo: 1 });
    await prisma.candidateCase.update({
      where: { id: candidate.id },
      data: { housingSecuredAt: new Date() },
    });

    const { notifyNewFindings } = await import('@/server/findings');
    expect(await notifyNewFindings(minutesAgo(10))).toBe(0);
  });
});
