/**
 * Contact workflow. All state changes go through this module so the
 * "opened != contacted" invariant is enforced in one place.
 */

import { prisma } from '@/lib/prisma';
import { formatEuroCents } from '@/lib/money';

const CLAIM_MINUTES = 20;

export interface ClaimListingInput {
  candidateCaseId: string;
  listingId: string;
  userId: string;
}

export async function claimListing({ candidateCaseId, listingId, userId }: ClaimListingInput) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CLAIM_MINUTES * 60_000);

  return prisma.$transaction(async (tx) => {
    // Refuse if a different user already holds an active claim.
    const active = await tx.listingClaim.findFirst({
      where: {
        listingId,
        releasedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (active && active.userId !== userId) {
      return { ok: false as const, reason: 'ALREADY_CLAIMED', by: active.userId } as const;
    }
    if (active && active.userId === userId) {
      const refreshed = await tx.listingClaim.update({
        where: { id: active.id },
        data: { expiresAt },
      });
      await tx.candidateListingMatch.updateMany({
        where: { candidateCaseId, listingId },
        data: { status: 'IN_PROGRESS' },
      });
      return { ok: true as const, claim: refreshed } as const;
    }
    const created = await tx.listingClaim.create({
      data: { candidateCaseId, listingId, userId, expiresAt },
    });
    await tx.candidateListingMatch.updateMany({
      where: { candidateCaseId, listingId },
      data: { status: 'IN_PROGRESS' },
    });
    await tx.auditEvent.create({
      data: {
        userId,
        candidateCaseId,
        entityType: 'Listing',
        entityId: listingId,
        action: 'listing.claim',
        toState: 'IN_PROGRESS',
      },
    });
    return { ok: true as const, claim: created } as const;
  });
}

export interface ConfirmContactInput {
  candidateCaseId: string;
  listingId: string;
  userId: string;
  overrideReason?: string;
}

export async function confirmContact(input: ConfirmContactInput) {
  return prisma.$transaction(async (tx) => {
    // Re-load candidate + message + listing under the transaction so we snapshot
    // the exact message that was on screen.
    const candidate = await tx.candidateCase.findUnique({
      where: { id: input.candidateCaseId },
      include: { applicationMessage: true },
    });
    if (!candidate) return { ok: false as const, reason: 'CANDIDATE_NOT_FOUND' as const };
    if (!candidate.applicationMessage || !candidate.applicationMessage.body.trim()) {
      return { ok: false as const, reason: 'MESSAGE_EMPTY' as const };
    }

    const listing = await tx.listing.findUnique({ where: { id: input.listingId } });
    if (!listing) return { ok: false as const, reason: 'LISTING_NOT_FOUND' as const };

    // Same candidate + same listing may never contact twice unless overridden.
    const same = await tx.contactAttempt.findFirst({
      where: { candidateCaseId: input.candidateCaseId, listingId: input.listingId },
    });
    if (same && !input.overrideReason) {
      return { ok: false as const, reason: 'ALREADY_CONTACTED_SAME_CANDIDATE', existingId: same.id } as const;
    }

    // Cross-candidate contact: warning is surfaced in UI; forcing needs override.
    const cross = await tx.contactAttempt.findFirst({
      where: { listingId: input.listingId, candidateCaseId: { not: input.candidateCaseId } },
      include: { candidateCase: true, user: true },
    });
    if (cross && !input.overrideReason) {
      return {
        ok: false as const,
        reason: 'ALREADY_CONTACTED_OTHER_CANDIDATE',
        otherCandidate: cross.candidateCase.reference,
        by: cross.user.name,
        at: cross.contactedAt,
      } as const;
    }

    const attempt = await tx.contactAttempt.create({
      data: {
        listingId: input.listingId,
        candidateCaseId: input.candidateCaseId,
        userId: input.userId,
        messageSnapshot: candidate.applicationMessage.body,
        overrideReason: input.overrideReason ?? null,
      },
    });

    await tx.systemTransfer.create({
      data: {
        contactAttemptId: attempt.id,
        objectLabel: listing.title,
        link: listing.canonicalUrl,
        location: [listing.locationPostal, listing.locationCity, listing.locationRaw]
          .filter(Boolean)
          .join(', '),
      },
    });

    await tx.candidateListingMatch.updateMany({
      where: { candidateCaseId: input.candidateCaseId, listingId: input.listingId },
      data: { status: 'CONTACTED' },
    });

    // Release any active claim.
    await tx.listingClaim.updateMany({
      where: {
        listingId: input.listingId,
        candidateCaseId: input.candidateCaseId,
        releasedAt: null,
      },
      data: { releasedAt: new Date() },
    });

    await tx.auditEvent.create({
      data: {
        userId: input.userId,
        candidateCaseId: input.candidateCaseId,
        entityType: 'Listing',
        entityId: input.listingId,
        action: 'listing.contact',
        toState: 'CONTACTED',
        reason: input.overrideReason ?? null,
      },
    });

    return { ok: true as const, contactAttemptId: attempt.id };
  });
}

export function formatSystemTransferPayload(t: { objectLabel: string; link: string; location: string }) {
  return {
    fields: [
      { label: 'Wohnung/Objekt', value: t.objectLabel },
      { label: 'Link', value: t.link },
      { label: 'Ort', value: t.location },
    ],
    combined: `Wohnung/Objekt: ${t.objectLabel}\nLink: ${t.link}\nOrt: ${t.location}`,
  };
}

/** Small helper the seed and tests use. */
export function summariseMonthly(listing: { effectiveMonthlyCents: number | null; monthlyTotalComplete: boolean }) {
  if (listing.effectiveMonthlyCents == null) return 'Miete unbekannt';
  const eur = formatEuroCents(listing.effectiveMonthlyCents);
  return listing.monthlyTotalComplete ? eur + ' warm' : eur + ' (Gesamtkosten unklar)';
}
