/**
 * „Für diesen Fall kommt nichts mehr nach" — an echten Datensätzen.
 *
 * Die Regeln selbst stehen in `tests/insights.test.ts` und brauchen keine
 * Datenbank. Hier geht es um die zwei Fehler, die man nur mit einer sieht,
 * und die beide dazu führten, dass die Warnung schlicht nie kam:
 *
 *  1. Der Zeitstempel wurde bei jeder Neuberechnung erneuert. Ein Klick auf
 *     „Suchprofil speichern" machte damit jeden Fall wieder taufrisch.
 *  2. Die Frage „kam überhaupt jemals etwas Passendes" wurde nur unter noch
 *     lebenden Anzeigen gestellt. Anzeigen laufen aber ab — und dann sah ein
 *     Fall, für den monatelang alles lief, aus wie einer, der nie einen
 *     Treffer hatte.
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

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function seedCase() {
  const { hashPassword } = await import('@/lib/auth');
  const { createCandidateCase } = await import('@/server/candidates');

  const user = await prisma.user.create({
    data: {
      email: 'stillstand@test.local',
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
    reference: 'CAND-STILL-01',
    displayName: 'Testkandidatin',
    createdById: user.id,
    workplace: { address: 'Salinenstr. 2, 74906 Bad Rappenau', city: 'Bad Rappenau', postalCode: '74906' },
    maxWarmmieteCents: 90000,
    minRooms: 1,
    preferredRooms: 2,
  });

  let n = 0;
  /** Ein passender Treffer, der vor `matchedDaysAgo` Tagen dazukam. */
  const addMatch = async (opts: {
    matchedDaysAgo: number;
    status?: 'NEW' | 'CONTACTED';
    dead?: boolean;
  }) => {
    n += 1;
    const listing = await prisma.listing.create({
      data: {
        sourceId: source.id,
        canonicalUrl: `https://www.kleinanzeigen.de/s-anzeige/wohnung/${2000 + n}`,
        rawUrl: `https://www.kleinanzeigen.de/s-anzeige/wohnung/${2000 + n}`,
        title: `Wohnung ${n}`,
        importedById: user.id,
        ...(opts.dead ? { expired: true, expiredAt: new Date(), lastCheckStatus: 'GONE' } : {}),
      },
    });
    return prisma.candidateListingMatch.create({
      data: {
        candidateCaseId: candidate.id,
        listingId: listing.id,
        status: opts.status ?? 'NEW',
        compatibility: 'COMPATIBLE',
        score: 80,
        reasons: [],
        breakdown: {},
        blockers: [],
        matchedAt: daysAgo(opts.matchedDaysAgo),
      },
    });
  };

  return { candidate, addMatch };
}

describe('Fälle, für die nichts mehr nachkommt', () => {
  it('meldet einen Fall, dessen letzter passender Treffer Wochen her ist', async () => {
    const { candidate, addMatch } = await seedCase();
    // Angeschrieben, also keine offene Aufgabe mehr — und seitdem kam nichts.
    await addMatch({ matchedDaysAgo: 30, status: 'CONTACTED' });

    const { stalledCases } = await import('@/server/insights');
    const [stalled] = await stalledCases();
    expect(stalled?.candidateCaseId).toBe(candidate.id);
    expect(stalled.daysQuiet).toBe(30);
  });

  it('schweigt, solange noch etwas Anschreibbares offen ist', async () => {
    const { addMatch } = await seedCase();
    await addMatch({ matchedDaysAgo: 30, status: 'CONTACTED' });
    await addMatch({ matchedDaysAgo: 30, status: 'NEW' });

    const { stalledCases } = await import('@/server/insights');
    // Das ist Rückstand, kein Stillstand: dort liegt Arbeit, sie ist nur nicht
    // getan. Eine Warnung wäre hier schlicht falsch.
    expect(await stalledCases()).toEqual([]);
  });

  it('lässt eine Neuberechnung die Uhr nicht zurückstellen', async () => {
    // Der Fehler, der die Warnung praktisch abschaltete: der Zeitstempel hieß
    // `computedAt` und wurde bei jedem Durchlauf erneuert. Nach einem Klick auf
    // „Suchprofil speichern" war jeder Fall wieder taufrisch, und „steht seit
    // Tagen still" konnte gar nicht mehr auslösen.
    const { candidate, addMatch } = await seedCase();
    const match = await addMatch({ matchedDaysAgo: 30, status: 'CONTACTED' });

    const { recomputeAllForCandidate } = await import('@/server/ranking');
    await recomputeAllForCandidate(candidate.id);

    const after = await prisma.candidateListingMatch.findUniqueOrThrow({
      where: { id: match.id },
      select: { matchedAt: true, updatedAt: true },
    });
    expect(after.matchedAt.getTime()).toBe(match.matchedAt.getTime());
    // Dass gerechnet wurde, steht weiterhin irgendwo — nur eben in dem Feld,
    // das genau das bedeutet.
    expect(after.updatedAt.getTime()).toBeGreaterThan(match.matchedAt.getTime());
  });

  it('zählt einen abgelaufenen Treffer weiter als Beleg, dass die Suche etwas hergab', async () => {
    // Sonst verschwindet mit jeder ablaufenden Anzeige auch die Vorgeschichte,
    // und ein Fall, für den es wochenlang lief, meldet sich als „noch nie ein
    // Treffer" — die härteste Formulierung, die es hier gibt.
    const { addMatch } = await seedCase();
    await addMatch({ matchedDaysAgo: 12, status: 'CONTACTED', dead: true });

    const { stalledCases } = await import('@/server/insights');
    const [stalled] = await stalledCases();
    expect(stalled.daysQuiet).toBe(12);
    expect(stalled.reason).not.toMatch(/Noch nie/);
  });

  it('sagt „noch nie", wenn wirklich noch nie etwas passte', async () => {
    await seedCase();
    const { stalledCases } = await import('@/server/insights');
    const [stalled] = await stalledCases();
    expect(stalled.daysQuiet).toBeNull();
    expect(stalled.reason).toMatch(/Noch nie/);
  });
});
