/**
 * Regression test for the filter that decides which ads a colleague sees.
 *
 * The bug this guards against was invisible in review and severe in practice:
 * `NOT: { lastCheckStatus: 'GONE' }` reads as "everything except the dead
 * ones", but in SQL `NOT (NULL = 'GONE')` is unknown rather than true, so every
 * ad the link checker had not reached yet was silently excluded. After a
 * discovery sweep that is most of the pool — the tool hid the majority of the
 * live flats it had just found.
 *
 * These tests run against the real database precisely because the fault was in
 * SQL's three-valued logic; no amount of in-memory testing would have caught
 * it.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import { LIVE_LISTING, DEAD_LISTING } from '@/server/listingFilters';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

async function seedListings() {
  const { hashPassword } = await import('@/lib/auth');
  const user = await prisma.user.create({
    data: {
      email: 'filter@test.local',
      name: 'Test',
      role: 'ADMIN',
      passwordHash: await hashPassword('test-pw-1234'),
    },
  });
  const source = await prisma.source.create({
    data: {
      key: 'test-source',
      name: 'Testquelle',
      websiteUrl: 'https://example.de',
      category: 'MARKETPLACE',
      integrationMode: 'SEARCH_LINK',
    },
  });

  const make = (slug: string, data: Record<string, unknown>) =>
    prisma.listing.create({
      data: {
        sourceId: source.id,
        importedById: user.id,
        canonicalUrl: `https://example.de/${slug}`,
        rawUrl: `https://example.de/${slug}`,
        title: slug,
        ...data,
      },
    });

  // The critical row: freshly discovered, never link-checked.
  await make('never-checked', { expired: false, lastCheckStatus: null });
  await make('checked-alive', { expired: false, lastCheckStatus: 'ALIVE' });
  await make('blocked', { expired: false, lastCheckStatus: 'BLOCKED' });
  await make('gone', { expired: false, lastCheckStatus: 'GONE' });
  await make('retired', { expired: true, lastCheckStatus: 'ALIVE' });
}

describe('LIVE_LISTING', () => {
  it('keeps ads the link checker has not reached yet', async () => {
    await seedListings();
    const live = await prisma.listing.findMany({ where: LIVE_LISTING, select: { title: true } });
    const titles = live.map((l) => l.title).sort();
    expect(titles).toEqual(['blocked', 'checked-alive', 'never-checked']);
  });

  it('excludes confirmed-gone and retired ads', async () => {
    await seedListings();
    const live = await prisma.listing.findMany({ where: LIVE_LISTING, select: { title: true } });
    const titles = live.map((l) => l.title);
    expect(titles).not.toContain('gone');
    expect(titles).not.toContain('retired');
  });

  it('a blocked portal never hides its ads', async () => {
    // BLOCKED means "we could not tell", which must read as alive — otherwise
    // one portal's anti-bot page empties the whole list.
    await seedListings();
    const count = await prisma.listing.count({ where: { ...LIVE_LISTING, title: 'blocked' } });
    expect(count).toBe(1);
  });

  it('is exactly the complement of DEAD_LISTING', async () => {
    await seedListings();
    const [total, live, dead] = await Promise.all([
      prisma.listing.count(),
      prisma.listing.count({ where: LIVE_LISTING }),
      prisma.listing.count({ where: DEAD_LISTING }),
    ]);
    expect(live + dead).toBe(total);
  });

  it('demonstrates the naive spelling that caused the bug', async () => {
    await seedListings();
    // Kept as executable documentation: this is what the code used to say, and
    // it drops the never-checked row. If a future Prisma version changes this
    // behaviour, this test tells us the workaround can be simplified.
    const naive = await prisma.listing.findMany({
      where: { expired: false, NOT: { lastCheckStatus: 'GONE' } },
      select: { title: true },
    });
    expect(naive.map((l) => l.title)).not.toContain('never-checked');
  });
});
