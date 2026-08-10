/**
 * Development helper: point the demo candidate at a real city and switch on
 * automatic discovery for the sources that can do it, so a sweep has something
 * to work with. Not part of the app.
 */
import { prisma } from '../src/lib/prisma';
import { syncSeedCatalog } from '../src/server/sources';

await syncSeedCatalog();

const profile = await prisma.searchProfile.findFirst();
if (profile) {
  await prisma.searchProfile.update({
    where: { id: profile.id },
    data: { workplaceCity: 'Heilbronn', workplacePostalCode: '74072', radiusKm: 25 },
  });
  console.log('profile →', 'Heilbronn / 74072');
}

const ka = await prisma.source.update({
  where: { key: 'kleinanzeigen' },
  data: { discoveryEnabled: true, discoveryConfig: { locationIds: ['9228'] } },
});
console.log('kleinanzeigen:', ka.discoveryAdapter, 'enabled =', ka.discoveryEnabled, JSON.stringify(ka.discoveryConfig));

await prisma.$disconnect();
