/**
 * Ingest a raw listing into the database:
 *  - normalise the URL,
 *  - run the deterministic parser,
 *  - store the Listing (idempotent on canonicalUrl),
 *  - persist extraction evidence as ListingFact rows,
 *  - compute duplicate suggestions,
 *  - re-compute CandidateListingMatch rows for all active candidates.
 */

import { prisma } from '@/lib/prisma';
import { normaliseUrl, extractSourceListingId } from '@/lib/url';
import { parseListing, type StructuredHints } from '@/domain/parser';
import { computeMatchesForListing } from './ranking';
import { registerDuplicates } from './duplicates';

export interface IngestInput {
  sourceId: string;
  rawUrl: string;
  title: string;
  descriptionRaw: string;
  locationRaw?: string;
  locationCity?: string | null;
  locationPostal?: string | null;
  imageUrl?: string | null;
  notes?: string | null;
  importedById: string;
  structured?: StructuredHints;
}

export interface IngestResult {
  listingId: string;
  created: boolean;
  facts: {
    propertyType: string;
    furnishing: string;
    warnings: string[];
  };
}

export async function ingestListing(input: IngestInput): Promise<IngestResult> {
  const canonicalUrl = normaliseUrl(input.rawUrl);
  const sourceListingId = extractSourceListingId(canonicalUrl);
  const facts = parseListing({
    title: input.title,
    description: input.descriptionRaw,
    structured: input.structured,
  });

  const listing = await prisma.$transaction(async (tx) => {
    const existing = await tx.listing.findUnique({ where: { canonicalUrl } });

    const data = {
      sourceId: input.sourceId,
      canonicalUrl,
      rawUrl: input.rawUrl,
      sourceListingId,
      title: input.title,
      descriptionRaw: input.descriptionRaw,
      locationRaw: input.locationRaw ?? '',
      locationCity: input.locationCity ?? null,
      locationPostal: input.locationPostal ?? null,
      imageUrl: input.imageUrl ?? null,
      notes: input.notes ?? null,

      propertyType: facts.propertyType,
      furnishing: facts.furnishing,
      fittedKitchen: facts.fittedKitchen,

      warmMieteCents: facts.warmMieteCents,
      kaltMieteCents: facts.kaltMieteCents,
      nebenkostenCents: facts.nebenkostenCents,
      heizkostenCents: facts.heizkostenCents,
      depositCents: facts.depositCents,
      abloeseCents: facts.abloeseCents,
      provisionNote: facts.provisionNote,
      monthlyTotalComplete: facts.monthlyTotalComplete,
      effectiveMonthlyCents: facts.effectiveMonthlyCents,

      rooms: facts.rooms,
      livingSpaceSqm: facts.livingSpaceSqm,
      availableFrom: facts.availableFrom,
      availableNow: facts.availableNow,

      wbsRequired: facts.wbsRequired,
      exchangeRequired: facts.exchangeRequired,
      petsAllowed: facts.petsAllowed,
      fixedTerm: facts.fixedTerm,
      minDurationMonths: facts.minDurationMonths,
      maxDurationMonths: facts.maxDurationMonths,
      anmeldungPossible: facts.anmeldungPossible,

      warnings: facts.warnings,
      extractorVersion: facts.extractorVersion,
      expired: false,
      importedById: input.importedById,
    };

    let record;
    if (existing) {
      // Re-ingest: refresh facts but preserve manual overrides. Manual
      // overrides live in ListingFact rows with isOverride=true. We do not
      // touch the top-level effective columns for facts that have an
      // active override.
      const overrides = await tx.listingFact.findMany({
        where: { listingId: existing.id, isOverride: true },
        select: { key: true },
      });
      const overriddenKeys = new Set(overrides.map((o) => o.key));
      const preserved: Partial<typeof data> = {};
      const preserveIf = (key: keyof typeof data) => {
        if (overriddenKeys.has(String(key))) {
          (preserved as Record<string, unknown>)[String(key)] = (existing as unknown as Record<string, unknown>)[
            String(key)
          ];
        }
      };
      for (const key of [
        'propertyType',
        'furnishing',
        'fittedKitchen',
        'warmMieteCents',
        'kaltMieteCents',
        'nebenkostenCents',
        'heizkostenCents',
        'depositCents',
        'abloeseCents',
        'rooms',
        'livingSpaceSqm',
        // A move-in date entered by hand usually came from a telephone call
        // with the landlord. The advert will still say nothing on the next
        // sweep, and nothing must not overwrite something.
        'availableFrom',
        'wbsRequired',
        'exchangeRequired',
        'petsAllowed',
      ] as const) {
        preserveIf(key);
      }
      record = await tx.listing.update({
        where: { id: existing.id },
        data: { ...data, ...preserved, version: { increment: 1 } },
      });
    } else {
      record = await tx.listing.create({ data });
    }

    // Replace non-override facts; keep override rows intact.
    await tx.listingFact.deleteMany({ where: { listingId: record.id, isOverride: false } });
    if (facts.evidence.length > 0) {
      await tx.listingFact.createMany({
        data: facts.evidence.map((e) => {
          const raw = (record as unknown as Record<string, unknown>)[e.key];
          // Prisma's Json input rejects a top-level `null`; use a marker instead.
          const value = raw === undefined || raw === null ? { present: false } : raw;
          return {
            listingId: record.id,
            key: e.key,
            valueJson: value as never,
            origin: e.origin,
            evidence: e.snippet,
            confidence: e.confidence,
            extractorVersion: facts.extractorVersion,
            isOverride: false,
          };
        }),
      });
    }

    await tx.auditEvent.create({
      data: {
        userId: input.importedById,
        entityType: 'Listing',
        entityId: record.id,
        action: existing ? 'listing.reimport' : 'listing.import',
      },
    });

    return record;
  });

  await registerDuplicates(listing.id);
  await computeMatchesForListing(listing.id);

  return {
    listingId: listing.id,
    created: !listing.updatedAt || listing.version === 0,
    facts: {
      propertyType: facts.propertyType,
      furnishing: facts.furnishing,
      warnings: facts.warnings,
    },
  };
}
