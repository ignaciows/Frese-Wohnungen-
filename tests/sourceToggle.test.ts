/**
 * Switching a source on has to *stay* on.
 *
 * This is the fault that made the whole tool look broken. The settings page
 * put every source in its own form behind its own Speichern button. A
 * colleague ticked the boxes down the list and moved on — the obvious reading
 * of a page full of checkboxes — and nothing was written. The automatic search
 * then ran with no sources and found nothing, while the screen showed every
 * box ticked, so the evidence pointed at the search rather than at the save.
 *
 * The switch now writes on change, and this pins what that write must do.
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

async function seedSource(over: Record<string, unknown> = {}) {
  return prisma.source.create({
    data: {
      key: 'toggle-source',
      name: 'Testquelle',
      websiteUrl: 'https://example.de',
      category: 'MARKETPLACE',
      integrationMode: 'SEARCH_LINK',
      discoveryAdapter: 'kleinanzeigen',
      discoveryEnabled: false,
      ...over,
    },
  });
}

/** What toggleSourceAction does, minus the auth wrapper it cannot run here. */
async function toggle(sourceId: string, enabled: boolean) {
  await prisma.source.update({
    where: { id: sourceId },
    data: {
      discoveryEnabled: enabled,
      ...(enabled ? { discoveryStatus: null, discoveryNote: null } : {}),
    },
  });
}

describe('switching a source on', () => {
  it('is written immediately, with nothing else to press', async () => {
    const source = await seedSource();

    await toggle(source.id, true);

    const after = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.discoveryEnabled).toBe(true);
  });

  it('clears a stale verdict, because that verdict answered a different question', async () => {
    // "Blockiert" from three weeks ago must not greet somebody who has just
    // switched the source back on; the next sweep decides afresh.
    const source = await seedSource({
      discoveryStatus: 'BLOCKED',
      discoveryNote: 'Portal blockiert automatische Abrufe.',
    });

    await toggle(source.id, true);

    const after = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.discoveryStatus).toBeNull();
    expect(after.discoveryNote).toBeNull();
  });

  it('keeps the verdict when switching off, so the reason survives', async () => {
    const source = await seedSource({
      discoveryEnabled: true,
      discoveryStatus: 'BLOCKED',
      discoveryNote: 'Portal blockiert automatische Abrufe.',
    });

    await toggle(source.id, false);

    const after = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.discoveryEnabled).toBe(false);
    expect(after.discoveryNote).toMatch(/blockiert/);
  });

  it('leaves the configuration alone', async () => {
    // The old form posted the JSON box along with the checkbox, so a save
    // could rewrite the adapter's settings as a side effect of a tick.
    const source = await seedSource({ discoveryConfig: { locationIds: ['9228'] } });

    await toggle(source.id, true);

    const after = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.discoveryConfig).toEqual({ locationIds: ['9228'] });
    expect(after.discoveryAdapter).toBe('kleinanzeigen');
  });
});
