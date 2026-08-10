/**
 * Retirement is the rule that decides whether a colleague's list is
 * trustworthy, and it can fail in both directions:
 *
 *  - too slow, and people keep opening ads that are gone — the original
 *    complaint;
 *  - too eager, and a good flat vanishes because a portal hiccupped, which is
 *    worse, because nobody ever finds out what they missed.
 *
 * So these tests are as much about what must *not* be retired.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import { retireUnseen } from '@/server/discovery';
import { DEFAULT_DISCOVERY } from '@/server/settings';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

const settings = { ...DEFAULT_DISCOVERY, retireAfterMissedSweeps: 2 };

async function seed(count: number) {
  const { hashPassword } = await import('@/lib/auth');
  const user = await prisma.user.create({
    data: {
      email: 'retire@test.local',
      name: 'Test',
      role: 'ADMIN',
      passwordHash: await hashPassword('test-pw-1234'),
    },
  });
  const source = await prisma.source.create({
    data: {
      key: 'retire-source',
      name: 'Testquelle',
      websiteUrl: 'https://example.de',
      category: 'MARKETPLACE',
      integrationMode: 'SEARCH_LINK',
      discoveryAdapter: 'kleinanzeigen',
      discoveryEnabled: true,
    },
  });

  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    const url = `https://example.de/ad-${i}`;
    urls.push(url);
    await prisma.listing.create({
      data: {
        sourceId: source.id,
        importedById: user.id,
        canonicalUrl: url,
        rawUrl: url,
        title: `Anzeige ${i}`,
        origin: 'DISCOVERY',
        expired: false,
      },
    });
  }
  return { source, urls, user };
}

const stateOf = (url: string) =>
  prisma.listing.findUniqueOrThrow({
    where: { canonicalUrl: url },
    select: { expired: true, missedSweeps: true, expiredBySystem: true, lastCheckReason: true },
  });

describe('retiring ads that left the result list', () => {
  it('one miss only counts; it does not hide the ad', async () => {
    const { source, urls } = await seed(4);
    // Everything except ad-0 was seen again.
    const seen = new Set(urls.slice(1));

    const retired = await retireUnseen(source.id, seen, settings);

    expect(retired).toBe(0);
    const ad0 = await stateOf(urls[0]);
    expect(ad0.expired).toBe(false);
    expect(ad0.missedSweeps).toBe(1);
  });

  it('a second consecutive miss retires it', async () => {
    const { source, urls } = await seed(4);
    const seen = new Set(urls.slice(1));

    await retireUnseen(source.id, seen, settings);
    const retired = await retireUnseen(source.id, seen, settings);

    expect(retired).toBe(1);
    const ad0 = await stateOf(urls[0]);
    expect(ad0.expired).toBe(true);
    // Recorded as the system's doing, so the UI can say who hid it.
    expect(ad0.expiredBySystem).toBe(true);
    expect(ad0.lastCheckReason).toMatch(/Ergebnisliste/);
  });

  it('reappearing resets the count, so a flapping portal never buries an ad', async () => {
    const { source, urls } = await seed(4);

    await retireUnseen(source.id, new Set(urls.slice(1)), settings);
    expect((await stateOf(urls[0])).missedSweeps).toBe(1);

    // Seen again — this is what upsertDiscovered does on a hit.
    await prisma.listing.update({
      where: { canonicalUrl: urls[0] },
      data: { missedSweeps: 0, lastListedAt: new Date() },
    });

    await retireUnseen(source.id, new Set(urls.slice(1)), settings);
    const ad0 = await stateOf(urls[0]);
    expect(ad0.expired).toBe(false);
    expect(ad0.missedSweeps).toBe(1);
  });

  it('retires nothing when a source loses its entire inventory at once', async () => {
    // Far likelier to mean the markup changed than that every flat was let.
    const { source } = await seed(8);

    const retired = await retireUnseen(source.id, new Set(), settings);

    expect(retired).toBe(0);
    expect(await prisma.listing.count({ where: { expired: true } })).toBe(0);
    const after = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.discoveryStatus).toBe('ERROR');
    expect(after.discoveryNote).toMatch(/Seitenstruktur/);
  });

  it('still retires when a small source legitimately empties out', async () => {
    // The all-gone guard only applies once there is enough inventory for the
    // pattern to mean anything; two ads disappearing is ordinary.
    const { source } = await seed(2);

    await retireUnseen(source.id, new Set(), settings);
    const retired = await retireUnseen(source.id, new Set(), settings);

    expect(retired).toBe(2);
  });

  it('leaves manually imported ads alone', async () => {
    // A colleague pasted it in; it never came from a result list, so absence
    // from one says nothing.
    const { source, urls, user } = await seed(3);
    await prisma.listing.create({
      data: {
        sourceId: source.id,
        importedById: user.id,
        canonicalUrl: 'https://example.de/manual',
        rawUrl: 'https://example.de/manual',
        title: 'Von Hand importiert',
        origin: 'MANUAL',
        expired: false,
      },
    });

    await retireUnseen(source.id, new Set(urls), settings);
    await retireUnseen(source.id, new Set(urls), settings);

    expect((await stateOf('https://example.de/manual')).expired).toBe(false);
  });

  it('moves the matches of a retired ad out of the working list', async () => {
    const { source, urls, user } = await seed(4);
    const candidate = await prisma.candidateCase.create({
      data: { reference: 'CAND-R-01', displayName: 'Test', createdById: user.id },
    });
    const listing = await prisma.listing.findUniqueOrThrow({ where: { canonicalUrl: urls[0] } });
    await prisma.candidateListingMatch.create({
      data: {
        candidateCaseId: candidate.id,
        listingId: listing.id,
        status: 'NEW',
        breakdown: {},
        reasons: [],
        blockers: [],
      },
    });

    const seen = new Set(urls.slice(1));
    await retireUnseen(source.id, seen, settings);
    await retireUnseen(source.id, seen, settings);

    const match = await prisma.candidateListingMatch.findFirstOrThrow({
      where: { listingId: listing.id },
    });
    expect(match.status).toBe('EXPIRED');
  });

  it('does not touch a match somebody already contacted', async () => {
    // The conversation outlives the ad; forcing it to EXPIRED would lose the
    // reply we are still waiting for.
    const { source, urls, user } = await seed(4);
    const candidate = await prisma.candidateCase.create({
      data: { reference: 'CAND-R-02', displayName: 'Test', createdById: user.id },
    });
    const listing = await prisma.listing.findUniqueOrThrow({ where: { canonicalUrl: urls[0] } });
    await prisma.candidateListingMatch.create({
      data: {
        candidateCaseId: candidate.id,
        listingId: listing.id,
        status: 'CONTACTED',
        breakdown: {},
        reasons: [],
        blockers: [],
      },
    });

    const seen = new Set(urls.slice(1));
    await retireUnseen(source.id, seen, settings);
    await retireUnseen(source.id, seen, settings);

    const match = await prisma.candidateListingMatch.findFirstOrThrow({
      where: { listingId: listing.id },
    });
    expect(match.status).toBe('CONTACTED');
  });
});

/**
 * A link-list adapter can only produce a URL: the advert link often wraps a
 * photo, so there is no title, price or size to read yet. Enrichment is what
 * fills that in — and when it cannot, the entry has to go, or the pool fills
 * with permanently empty rows. A live run had 31 of 85 in exactly that state.
 */
describe('entries that never become readable', () => {
  it('an entry with no figures is what enrichment exists for', async () => {
    // Documents the ordering rule: "has nothing" comes before "is newest".
    // Ordering purely by newest let a busy source fill the budget every sweep,
    // so the empty ones were never reached at all.
    // Seed no ads of its own: seed() creates figure-less rows, which are
    // exactly what this query is meant to select.
    const { source, user } = await seed(0);
    const empty = await prisma.listing.create({
      data: {
        sourceId: source.id,
        importedById: user.id,
        canonicalUrl: 'https://example.de/expose/empty',
        rawUrl: 'https://example.de/expose/empty',
        title: 'Anzeige (Titel folgt bei Detailprüfung)',
        origin: 'DISCOVERY',
        expired: false,
      },
    });
    const complete = await prisma.listing.create({
      data: {
        sourceId: source.id,
        importedById: user.id,
        canonicalUrl: 'https://example.de/expose/complete',
        rawUrl: 'https://example.de/expose/complete',
        title: '2-Zimmer-Wohnung',
        rooms: 2,
        kaltMieteCents: 78000,
        origin: 'DISCOVERY',
        expired: false,
      },
    });

    const emptyRows = await prisma.listing.findMany({
      where: {
        origin: 'DISCOVERY',
        expired: false,
        lastCheckedAt: null,
        kaltMieteCents: null,
        warmMieteCents: null,
        rooms: null,
        livingSpaceSqm: null,
      },
      select: { id: true },
    });
    expect(emptyRows.map((r) => r.id)).toEqual([empty.id]);
    expect(emptyRows.map((r) => r.id)).not.toContain(complete.id);
  });

  it('a retirement for unreadability survives the ad being listed again', async () => {
    // Without this the sweep resurrects it, enrichment retires it, and the
    // whole per-sweep budget goes on the same dead links forever.
    const { source, user } = await seed(0);
    const dead = await prisma.listing.create({
      data: {
        sourceId: source.id,
        importedById: user.id,
        canonicalUrl: 'https://example.de/expose/blocked',
        rawUrl: 'https://example.de/expose/blocked',
        title: 'Anzeige (Titel folgt bei Detailprüfung)',
        origin: 'DISCOVERY',
        expired: true,
        expiredBySystem: true,
        lastCheckStatus: 'UNREADABLE',
        lastCheckedAt: new Date(),
      },
    });

    // The un-retire rule keys on this marker; anything else is resurrected.
    const row = await prisma.listing.findUniqueOrThrow({ where: { id: dead.id } });
    expect(row.lastCheckStatus).toBe('UNREADABLE');
    expect(row.expired).toBe(true);
  });
});
