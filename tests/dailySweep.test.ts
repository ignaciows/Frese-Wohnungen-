/**
 * "Wurde für diese Kandidatin heute schon gesucht?"
 *
 * The global throttle answers a different question — "did *a* sweep run
 * recently" — and the sweep is shared: five nurses at the same clinic produce
 * one search. So a run half an hour ago for somebody in Hamburg used to
 * silence the search for somebody in Köln whose list was a week old.
 *
 * The rule these tests hold: opening a case searches when today's search for
 * that case has not happened yet, and does nothing on every visit after it.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import { sweepSkipReason } from '@/server/discovery';
import { SETTING_KEYS } from '@/server/settings';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

/** A candidate, plus a sweep that ran seconds ago — the throttle says "no". */
async function seed(opts: { lastSweptAt?: Date | null; secured?: boolean } = {}) {
  const { hashPassword } = await import('@/lib/auth');
  const user = await prisma.user.create({
    data: {
      email: 'daily@test.local',
      name: 'Test',
      role: 'ADMIN',
      passwordHash: await hashPassword('test-pw-1234'),
    },
  });

  // Discovery on, otherwise everything is skipped for a different reason.
  await prisma.appSetting.create({
    data: { key: SETTING_KEYS.discovery, valueJson: { enabled: true } },
  });

  const source = await prisma.source.create({
    data: {
      key: 'kleinanzeigen',
      name: 'Kleinanzeigen',
      websiteUrl: 'https://www.kleinanzeigen.de/',
      route: 'DISCOVERY',
      discoveryAdapter: 'kleinanzeigen',
      discoveryEnabled: true,
    },
  });
  await prisma.discoveryRun.create({
    data: {
      sourceId: source.id,
      adapter: 'kleinanzeigen',
      status: 'OK',
      query: {},
      startedAt: new Date(),
    },
  });

  const candidate = await prisma.candidateCase.create({
    data: {
      reference: 'CAND-DAILY-01',
      displayName: 'Testkandidatin',
      createdById: user.id,
      lastSweptAt: opts.lastSweptAt ?? null,
      ...(opts.secured ? { housingSecuredAt: new Date() } : {}),
    },
  });
  return { candidate };
}

const yesterday = () => new Date(Date.now() - 26 * 3600_000);

describe('the daily search when a case is opened', () => {
  it('runs when nobody has searched for this candidate yet', async () => {
    const { candidate } = await seed({ lastSweptAt: null });
    // The global throttle would say "just searched"...
    expect(await sweepSkipReason()).toBe('Zuletzt vor Kurzem gesucht.');
    // ...but this candidate has never been covered, so it searches anyway.
    expect(await sweepSkipReason(candidate.id)).toBeNull();
  });

  it('runs when the last search for them was yesterday', async () => {
    const { candidate } = await seed({ lastSweptAt: yesterday() });
    expect(await sweepSkipReason(candidate.id)).toBeNull();
  });

  it('does nothing on the fourth visit the same day', async () => {
    const { candidate } = await seed({ lastSweptAt: new Date() });
    expect(await sweepSkipReason(candidate.id)).toBe('Zuletzt vor Kurzem gesucht.');
  });

  it('leaves a candidate who already has a flat alone', async () => {
    // Their case is closed; searching for them spends the request budget the
    // people still looking need.
    const { candidate } = await seed({ lastSweptAt: yesterday(), secured: true });
    expect(await sweepSkipReason(candidate.id)).toBe('Zuletzt vor Kurzem gesucht.');
  });

  it('still respects the master switch', async () => {
    // Daily freshness never overrides "automatische Suche ist aus".
    const { candidate } = await seed({ lastSweptAt: yesterday() });
    await prisma.appSetting.update({
      where: { key: SETTING_KEYS.discovery },
      data: { valueJson: { enabled: false } },
    });
    expect(await sweepSkipReason(candidate.id)).toBe('Automatische Suche ist ausgeschaltet.');
  });
});
