/**
 * Development helper: run one discovery sweep against the live sources and
 * print what happened. Not part of the app — `npx tsx scripts/dev-sweep.mts`.
 */
import { prisma } from '../src/lib/prisma';
import { runDiscoverySweep } from '../src/server/discovery';

const summary = await runDiscoverySweep({ force: true });
console.log('=== SWEEP ===');
console.log(JSON.stringify(summary, null, 2));

const runs = await prisma.discoveryRun.findMany({
  orderBy: { startedAt: 'desc' },
  take: 8,
  include: { source: { select: { name: true } } },
});
console.log('=== RUNS ===');
for (const r of runs) {
  console.log(
    `${r.source.name} [${r.adapter}] ${r.status} found=${r.found} created=${r.created} updated=${r.updated} ${r.message ?? ''}`,
  );
}

const listings = await prisma.listing.findMany({
  where: { origin: 'DISCOVERY' },
  orderBy: { firstSeenAt: 'desc' },
  take: 10,
  select: {
    title: true,
    locationPostal: true,
    locationCity: true,
    effectiveMonthlyCents: true,
    kaltMieteCents: true,
    rooms: true,
    livingSpaceSqm: true,
    propertyType: true,
    canonicalUrl: true,
    contactEmail: true,
  },
});
console.log(`=== LISTINGS (${await prisma.listing.count({ where: { origin: 'DISCOVERY' } })} total) ===`);
for (const l of listings) {
  console.log(
    [
      l.title.slice(0, 45).padEnd(45),
      `${l.locationPostal ?? '?????'} ${(l.locationCity ?? '?').slice(0, 14)}`.padEnd(21),
      l.kaltMieteCents ? `${(l.kaltMieteCents / 100).toFixed(0)}€`.padStart(6) : '     ?',
      `${l.rooms ?? '?'}Zi`.padStart(5),
      `${l.livingSpaceSqm ?? '?'}m2`.padStart(7),
      l.propertyType.padEnd(10),
      l.contactEmail ?? '',
    ].join(' | '),
  );
}

const matches = await prisma.candidateListingMatch.groupBy({
  by: ['compatibility'],
  _count: true,
});
console.log('=== MATCHES ===', JSON.stringify(matches));

await prisma.$disconnect();
