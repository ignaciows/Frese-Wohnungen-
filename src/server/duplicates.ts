import { prisma } from '@/lib/prisma';
import { findDuplicates, type DuplicateCandidate } from '@/domain/duplicates';

function toCandidate(l: {
  id: string;
  canonicalUrl: string;
  sourceListingId: string | null;
  title: string;
  locationRaw: string;
  effectiveMonthlyCents: number | null;
  rooms: number | null;
  livingSpaceSqm: number | null;
}): DuplicateCandidate {
  return {
    id: l.id,
    canonicalUrl: l.canonicalUrl,
    sourceListingId: l.sourceListingId,
    title: l.title,
    locationRaw: l.locationRaw,
    effectiveMonthlyCents: l.effectiveMonthlyCents,
    rooms: l.rooms,
    livingSpaceSqm: l.livingSpaceSqm,
  };
}

export async function registerDuplicates(listingId: string): Promise<void> {
  const target = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
  const others = await prisma.listing.findMany({
    where: { id: { not: listingId } },
    take: 500,
  });
  const matches = findDuplicates(toCandidate(target), others.map(toCandidate));
  if (matches.length === 0) return;

  // Add each strong match into a shared DuplicateGroup with the target.
  await prisma.$transaction(async (tx) => {
    for (const m of matches) {
      // Reuse a group either listing is already part of; otherwise create one.
      const existing = await tx.duplicateMember.findFirst({
        where: { OR: [{ listingId: target.id }, { listingId: m.otherId }] },
        include: { group: true },
      });
      const groupId =
        existing?.groupId ??
        (await tx.duplicateGroup.create({ data: { status: 'SUSPECTED' } })).id;

      for (const [id, conf, reasons] of [
        [target.id, m.confidence, m.reasons] as const,
        [m.otherId, m.confidence, m.reasons] as const,
      ]) {
        await tx.duplicateMember.upsert({
          where: { groupId_listingId: { groupId, listingId: id } },
          create: { groupId, listingId: id, confidence: conf, reasons },
          update: { confidence: conf, reasons },
        });
      }
    }
  });
}
