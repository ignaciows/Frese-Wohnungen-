/**
 * Development helper: switch on the sources the live probe confirmed, so a
 * sweep has several real sources to work with. Not part of the app — the same
 * thing is done in the settings UI.
 */
import { prisma } from '../src/lib/prisma';
import { syncSeedCatalog } from '../src/server/sources';

await syncSeedCatalog();

const config: Record<string, { config: Record<string, unknown>; poll: number }> = {
  kleinanzeigen: { config: { locationIds: ['9228'] }, poll: 15 },
  telegram: {
    config: { channels: 'wohnungenberlin', requireCity: '' },
    poll: 10,
  },
  immowelt: {
    config: {
      searchUrlTemplate: 'https://www.immowelt.de/liste/{citySlug}/wohnungen/mieten?sp={page}',
      linkPattern: '\\/expose\\/',
    },
    poll: 30,
  },
  degewo: {
    config: { searchUrlTemplate: 'https://immosuche.degewo.de/de/search', linkPattern: '\\/detail' },
    poll: 60,
  },
  gewobag: {
    config: {
      searchUrlTemplate: 'https://www.gewobag.de/fuer-mieter-und-mietinteressenten/mietangebote/',
      linkPattern: '\\/mietangebot',
    },
    poll: 60,
  },
};

const keyByAdapter: Record<string, string> = {
  kleinanzeigen: 'kleinanzeigen',
  telegram: 'telegram-kanaele',
  immowelt: 'immowelt',
  degewo: 'degewo',
  gewobag: 'gewobag',
};

for (const [alias, entry] of Object.entries(config)) {
  const key = keyByAdapter[alias];
  const source = await prisma.source.findUnique({ where: { key } });
  if (!source) {
    console.log(`skip ${key} — not in catalogue`);
    continue;
  }
  await prisma.source.update({
    where: { key },
    data: {
      discoveryEnabled: true,
      discoveryConfig: entry.config as never,
      pollIntervalMinutes: entry.poll,
      discoveryStatus: null,
      discoveryNote: null,
      lastDiscoveredAt: null,
    },
  });
  console.log(`enabled ${key} (${source.discoveryAdapter}) every ${entry.poll} min`);
}

await prisma.$disconnect();
