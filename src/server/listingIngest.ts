/**
 * Ingest a raw listing into the database:
 *  - normalise the URL,
 *  - run the deterministic parser,
 *  - store the Listing (idempotent on canonicalUrl),
 *  - persist extraction evidence as ListingFact rows,
 *  - compute duplicate suggestions,
 *  - re-compute CandidateListingMatch rows for all active candidates.
 *
 * Every route into the app ends up here: the manual paste, the search-agent
 * mails from ImmoScout24 and Immowelt, and the Kleinanzeigen sweep. So this is
 * also the one place where the contact details get read out of the ad text —
 * do it here and every route gets phone numbers, not just the one somebody
 * remembered to wire up.
 */

import { prisma } from '@/lib/prisma';
import { normaliseUrl, extractSourceListingId } from '@/lib/url';
import { parseListing, type StructuredHints } from '@/domain/parser';
import { computeMatchesForListing } from './ranking';
import { registerDuplicates } from './duplicates';
import { findContact, NO_CONTACT } from '@/domain/contact';
import { featureOn } from '@/server/settings';

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
  /**
   * Contact details the *source* already knew — Kleinanzeigen names the seller
   * in its markup, for instance. These win over anything read out of the text.
   */
  contactEmail?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactFormUrl?: string | null;
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
  // What the ad itself published about reaching the landlord. A number in the
  // text is the fastest route there is — see domain/contact.
  //
  // Abschaltbar: wer die Nummern nicht lesen lassen will, bekommt hier nichts
  // Gelesenes. Bereits gespeicherte Nummern bleiben, weil unten ohnehin nie
  // ein Leerwert eine vorhandene Angabe überschreibt.
  const found = (await featureOn('contactExtraction'))
    ? findContact(`${input.title}\n${input.descriptionRaw}`)
    : NO_CONTACT;
  const contact = {
    contactEmail: input.contactEmail ?? found.email,
    contactName: input.contactName ?? found.name,
    contactPhone: input.contactPhone ?? found.phone,
    contactFormUrl: input.contactFormUrl ?? null,
  };

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
      ...contact,
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
      // A contact detail we once had is never dropped because this pass did
      // not find it. Portals hide the number again once an ad gets popular,
      // and losing it would mean losing the only fast way to that landlord.
      const keptContact = {
        contactEmail: contact.contactEmail ?? existing.contactEmail,
        contactName: contact.contactName ?? existing.contactName,
        contactPhone: contact.contactPhone ?? existing.contactPhone,
        contactFormUrl: contact.contactFormUrl ?? existing.contactFormUrl,
      };
      record = await tx.listing.update({
        where: { id: existing.id },
        data: { ...data, ...preserved, ...keptContact, version: { increment: 1 } },
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
