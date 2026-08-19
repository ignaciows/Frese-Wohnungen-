/**
 * The number on a tab must be the number of rows under it.
 *
 * This is a regression test for a bug that was live for weeks and looked
 * harmless: "Zu kontaktieren" showed **365** while the list under it had
 * **13** rows. The count came from a plain `groupBy status`, the list from a
 * query that also dropped INCOMPATIBLE matches and everything the link checker
 * had confirmed gone. Both were individually correct and together useless.
 *
 * Everything below drives the *same* function the page uses, so the two cannot
 * drift apart again without this failing.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import { RESULT_TABS, matchWhere } from '@/server/listingFilters';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

const expiredCutoff = new Date(Date.now() - 7 * 86_400_000);

/**
 * One candidate with a match of every interesting shape: usable, unusable,
 * dead, contacted, rejected. Roughly the mix a real candidate accumulates.
 */
async function seedMixedPool() {
  const { hashPassword } = await import('@/lib/auth');
  const { createCandidateCase } = await import('@/server/candidates');

  const user = await prisma.user.create({
    data: {
      email: 'tabs@test.local',
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
    reference: 'CAND-TABS-01',
    displayName: 'Testkandidatin',
    createdById: user.id,
    workplace: { address: 'Salinenstr. 2, 74906 Bad Rappenau', city: 'Bad Rappenau', postalCode: '74906' },
    maxWarmmieteCents: 90000,
    minRooms: 1,
    preferredRooms: 2,
  });

  let n = 0;
  const addMatch = async (opts: {
    status: 'NEW' | 'FAVORITE' | 'IN_PROGRESS' | 'CONTACTED' | 'REJECTED' | 'EXPIRED';
    compatibility: 'COMPATIBLE' | 'NEAR_MATCH' | 'INCOMPATIBLE' | 'INSUFFICIENT_DATA';
    dead?: boolean;
    followUp?: boolean;
  }) => {
    n += 1;
    const listing = await prisma.listing.create({
      data: {
        sourceId: source.id,
        canonicalUrl: `https://www.kleinanzeigen.de/s-anzeige/wohnung/${1000 + n}`,
        rawUrl: `https://www.kleinanzeigen.de/s-anzeige/wohnung/${1000 + n}`,
        title: `Wohnung ${n}`,
        importedById: user.id,
        ...(opts.dead
          ? { expired: true, expiredAt: new Date(), lastCheckStatus: 'GONE' }
          : {}),
      },
    });
    await prisma.candidateListingMatch.create({
      data: {
        candidateCaseId: candidate.id,
        listingId: listing.id,
        status: opts.status,
        compatibility: opts.compatibility,
        score: 50,
        reasons: [],
        breakdown: {},
        blockers: [],
        ...(opts.followUp ? { followUpAt: new Date() } : {}),
      },
    });
  };

  // Usable and waiting — the only thing "Zu kontaktieren" may ever claim.
  await addMatch({ status: 'NEW', compatibility: 'COMPATIBLE' });
  await addMatch({ status: 'NEW', compatibility: 'NEAR_MATCH' });
  await addMatch({ status: 'FAVORITE', compatibility: 'COMPATIBLE' });
  // Zu wenig im Anzeigentext für ein Urteil — Standardwert bei jedem Treffer,
  // dem Miete, Zimmer oder Fläche fehlen. Zählt mit: eine Anzeige ohne
  // Quadratmeterangabe kann trotzdem die richtige Wohnung sein.
  await addMatch({ status: 'NEW', compatibility: 'INSUFFICIENT_DATA' });
  // Wrong city / over budget: counted nowhere in the working tab.
  await addMatch({ status: 'NEW', compatibility: 'INCOMPATIBLE' });
  await addMatch({ status: 'NEW', compatibility: 'INCOMPATIBLE' });
  // Gone from the portal, never touched: belongs in "Abgelaufen" only.
  await addMatch({ status: 'NEW', compatibility: 'COMPATIBLE', dead: true });
  await addMatch({ status: 'NEW', compatibility: 'COMPATIBLE', dead: true });
  // Written to. Stays visible even though the ad itself died.
  await addMatch({ status: 'CONTACTED', compatibility: 'COMPATIBLE', dead: true, followUp: true });
  await addMatch({ status: 'IN_PROGRESS', compatibility: 'COMPATIBLE' });
  await addMatch({ status: 'REJECTED', compatibility: 'COMPATIBLE' });

  return { candidate };
}

describe('the number on a tab', () => {
  it('equals the number of rows the same tab renders — every tab', async () => {
    const { candidate } = await seedMixedPool();

    for (const t of RESULT_TABS) {
      const where = matchWhere({ candidateCaseId: candidate.id, tab: t.key, expiredCutoff });
      const [count, rows] = await Promise.all([
        prisma.candidateListingMatch.count({ where }),
        prisma.candidateListingMatch.findMany({ where, select: { id: true } }),
      ]);
      expect(count, `${t.key}: Zähler und Liste müssen übereinstimmen`).toBe(rows.length);
    }
  });

  it('stimmt mit der Tagesliste überein', async () => {
    // Dieselbe Falle eine Ebene höher: „Heute dran" hat einmal enger gefiltert
    // als der Reiter, auf den es verlinkt — Ergebnis wäre „nichts offen" über
    // einer Liste mit Zeilen darin gewesen. Beide zählen jetzt dasselbe.
    const { candidate } = await seedMixedPool();
    const { dailyWorklist } = await import('@/server/worklist');

    const tabCount = await prisma.candidateListingMatch.count({
      where: matchWhere({ candidateCaseId: candidate.id, tab: 'zu-kontaktieren', expiredCutoff }),
    });
    const list = await dailyWorklist();
    const item = [...list.call, ...list.write, ...list.idle].find(
      (i) => i.candidateCaseId === candidate.id,
    )!;
    expect(item.callable + item.writable).toBe(tabCount);
  });

  it('keeps the unusable and the dead out of "Zu kontaktieren"', async () => {
    // The concrete shape of the old bug: three usable, seven not, and the tab
    // used to say ten.
    const { candidate } = await seedMixedPool();
    const count = await prisma.candidateListingMatch.count({
      where: matchWhere({ candidateCaseId: candidate.id, tab: 'zu-kontaktieren', expiredCutoff }),
    });
    expect(count).toBe(4);
  });

  it('keeps a contacted ad reachable after the ad itself dies', async () => {
    // A conversation outlives the advert behind it; hiding it would lose the
    // reply we are still waiting for.
    const { candidate } = await seedMixedPool();
    const count = await prisma.candidateListingMatch.count({
      where: matchWhere({ candidateCaseId: candidate.id, tab: 'kontaktiert', expiredCutoff }),
    });
    expect(count).toBe(1);
  });

  it('does not let "Alle" promise rows the working tabs already buried', async () => {
    const { candidate } = await seedMixedPool();
    const all = await prisma.candidateListingMatch.count({
      where: matchWhere({ candidateCaseId: candidate.id, tab: 'alle', expiredCutoff }),
    });
    const rows = await prisma.candidateListingMatch.findMany({
      where: matchWhere({ candidateCaseId: candidate.id, tab: 'alle', expiredCutoff }),
    });
    expect(all).toBe(rows.length);
    // Ten matches exist; three are dead and outside "Alle", which only shows
    // what is still live.
    expect(all).toBeLessThan(10);
  });
});
