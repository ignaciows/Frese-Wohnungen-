/** Development helper: forget everything automatic discovery found. */
import { prisma } from '../src/lib/prisma';

const listings = await prisma.listing.deleteMany({ where: { origin: 'DISCOVERY' } });
const runs = await prisma.discoveryRun.deleteMany({});
console.log(`removed ${listings.count} listings, ${runs.count} runs`);
await prisma.$disconnect();
