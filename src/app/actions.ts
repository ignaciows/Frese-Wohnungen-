'use server';

/**
 * Server actions used by the workbench UI. Each action re-authenticates
 * against the session cookie and then hands off to the service layer.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser, requireAdmin } from '@/lib/auth';
import { createCandidateCase, updateApplicationMessage, updateSearchProfile } from '@/server/candidates';
import { ingestListing } from '@/server/listingIngest';
import { createSearchRun, updateSourceCheckStatus } from '@/server/searchRuns';
import { claimListing, confirmContact } from '@/server/contact';
import { markSystemTransferRegistered } from '@/server/systemTransfer';
import { syncSeedCatalog } from '@/server/sources';

const CandidateInput = z.object({
  reference: z.string().min(2).max(64),
  displayName: z.string().min(2).max(128),
  workplaceAddress: z.string().min(2).max(256),
  workplaceCity: z.string().max(128).optional().nullable(),
  workplacePostalCode: z.string().max(16).optional().nullable(),
  maxWarmmieteEuros: z.coerce.number().int().min(100).max(10000).default(900),
  minRooms: z.coerce.number().min(0.5).max(20).default(1),
  preferredRooms: z.coerce.number().min(0.5).max(20).default(2),
  adults: z.coerce.number().int().min(1).max(10).default(1),
  children: z.coerce.number().int().min(0).max(10).default(0),
  maxCommuteMinutes: z.coerce.number().int().min(1).max(240).default(35),
  furnished: z.enum(['REQUIRED', 'PREFERRED', 'EITHER']).default('PREFERRED'),
  wbsStatus: z.enum(['AVAILABLE', 'NOT_AVAILABLE', 'UNKNOWN']).default('UNKNOWN'),
  temporaryMode: z.coerce.boolean().default(false),
});

export async function createCandidateAction(formData: FormData) {
  const user = await requireUser();
  const raw = Object.fromEntries(formData);
  const parsed = CandidateInput.parse(raw);
  const candidate = await createCandidateCase({
    reference: parsed.reference,
    displayName: parsed.displayName,
    createdById: user.id,
    workplace: {
      address: parsed.workplaceAddress,
      city: parsed.workplaceCity || null,
      postalCode: parsed.workplacePostalCode || null,
    },
    maxWarmmieteCents: parsed.maxWarmmieteEuros * 100,
    minRooms: parsed.minRooms,
    preferredRooms: parsed.preferredRooms,
    adults: parsed.adults,
    children: parsed.children,
    maxCommuteMinutes: parsed.maxCommuteMinutes,
    furnished: parsed.furnished,
    wbsStatus: parsed.wbsStatus,
    temporaryMode: parsed.temporaryMode,
  });
  await createSearchRun(candidate.id, user.id, 'Erster Suchlauf');
  redirect(`/?case=${candidate.id}`);
}

const MessageInput = z.object({
  candidateCaseId: z.string(),
  body: z.string().max(20_000),
});

export async function saveMessageAction(formData: FormData) {
  const user = await requireUser();
  const parsed = MessageInput.parse(Object.fromEntries(formData));
  await updateApplicationMessage({
    candidateCaseId: parsed.candidateCaseId,
    body: parsed.body,
    userId: user.id,
  });
  revalidatePath('/');
}

const ProfileInput = z.object({
  candidateCaseId: z.string(),
  workplaceAddress: z.string().min(2).max(256),
  workplaceCity: z.string().max(128).optional().nullable(),
  workplacePostalCode: z.string().max(16).optional().nullable(),
  maxWarmmieteEuros: z.coerce.number().int().min(100).max(10000),
  minRooms: z.coerce.number().min(0.5).max(20),
  preferredRooms: z.coerce.number().min(0.5).max(20),
  maxCommuteMinutes: z.coerce.number().int().min(1).max(240),
  furnished: z.enum(['REQUIRED', 'PREFERRED', 'EITHER']),
  wbsStatus: z.enum(['AVAILABLE', 'NOT_AVAILABLE', 'UNKNOWN']),
  temporaryMode: z.coerce.boolean().default(false),
});

export async function saveProfileAction(formData: FormData) {
  const user = await requireUser();
  const parsed = ProfileInput.parse(Object.fromEntries(formData));
  await updateSearchProfile({
    candidateCaseId: parsed.candidateCaseId,
    patch: {
      workplaceAddress: parsed.workplaceAddress,
      workplaceCity: parsed.workplaceCity || null,
      workplacePostalCode: parsed.workplacePostalCode || null,
      maxWarmmieteCents: parsed.maxWarmmieteEuros * 100,
      minRooms: parsed.minRooms,
      preferredRooms: parsed.preferredRooms,
      maxCommuteMinutes: parsed.maxCommuteMinutes,
      furnished: parsed.furnished,
      wbsStatus: parsed.wbsStatus,
      temporaryMode: parsed.temporaryMode,
    },
    userId: user.id,
  });
  revalidatePath('/');
}

const ImportInput = z.object({
  sourceId: z.string(),
  rawUrl: z.string().url().max(1024),
  title: z.string().min(2).max(512),
  descriptionRaw: z.string().max(20_000),
  locationRaw: z.string().max(256).optional(),
  locationCity: z.string().max(128).optional(),
  locationPostal: z.string().max(16).optional(),
});

export async function importListingAction(formData: FormData) {
  const user = await requireUser();
  const parsed = ImportInput.parse(Object.fromEntries(formData));
  await ingestListing({
    sourceId: parsed.sourceId,
    rawUrl: parsed.rawUrl,
    title: parsed.title,
    descriptionRaw: parsed.descriptionRaw,
    locationRaw: parsed.locationRaw,
    locationCity: parsed.locationCity || null,
    locationPostal: parsed.locationPostal || null,
    importedById: user.id,
  });
  revalidatePath('/');
}

export async function newSearchRunAction(formData: FormData) {
  const user = await requireUser();
  const candidateCaseId = String(formData.get('candidateCaseId'));
  await createSearchRun(candidateCaseId, user.id, 'Neuer Suchlauf');
  revalidatePath('/');
}

const SourceCheckInput = z.object({
  sourceCheckId: z.string(),
  status: z.enum([
    'PENDING',
    'IN_PROGRESS',
    'CHECKED_NO_RESULTS',
    'CHECKED_RESULTS_IMPORTED',
    'UNAVAILABLE',
    'SKIPPED',
  ]),
  note: z.string().max(512).optional(),
});

export async function updateSourceCheckAction(formData: FormData) {
  const user = await requireUser();
  const parsed = SourceCheckInput.parse(Object.fromEntries(formData));
  await updateSourceCheckStatus({
    sourceCheckId: parsed.sourceCheckId,
    userId: user.id,
    status: parsed.status,
    note: parsed.note,
  });
  revalidatePath('/');
}

export async function claimListingAction(formData: FormData) {
  const user = await requireUser();
  const candidateCaseId = String(formData.get('candidateCaseId'));
  const listingId = String(formData.get('listingId'));
  await claimListing({ candidateCaseId, listingId, userId: user.id });
  revalidatePath('/');
}

export async function favoriteListingAction(formData: FormData) {
  const user = await requireUser();
  const candidateCaseId = String(formData.get('candidateCaseId'));
  const listingId = String(formData.get('listingId'));
  await prisma.$transaction([
    prisma.candidateListingMatch.updateMany({
      where: { candidateCaseId, listingId },
      data: { status: 'FAVORITE' },
    }),
    prisma.auditEvent.create({
      data: {
        userId: user.id,
        candidateCaseId,
        entityType: 'Listing',
        entityId: listingId,
        action: 'listing.favorite',
        toState: 'FAVORITE',
      },
    }),
  ]);
  revalidatePath('/');
}

export async function rejectListingAction(formData: FormData) {
  const user = await requireUser();
  const candidateCaseId = String(formData.get('candidateCaseId'));
  const listingId = String(formData.get('listingId'));
  const reason = String(formData.get('reason') ?? '').slice(0, 256) || null;
  await prisma.$transaction([
    prisma.candidateListingMatch.updateMany({
      where: { candidateCaseId, listingId },
      data: { status: 'REJECTED', rejectedReason: reason },
    }),
    prisma.auditEvent.create({
      data: {
        userId: user.id,
        candidateCaseId,
        entityType: 'Listing',
        entityId: listingId,
        action: 'listing.reject',
        toState: 'REJECTED',
        reason,
      },
    }),
  ]);
  revalidatePath('/');
}

const ConfirmContactInput = z.object({
  candidateCaseId: z.string(),
  listingId: z.string(),
  overrideReason: z.string().max(256).optional(),
});

export async function confirmContactAction(formData: FormData) {
  const user = await requireUser();
  const parsed = ConfirmContactInput.parse(Object.fromEntries(formData));
  const result = await confirmContact({
    candidateCaseId: parsed.candidateCaseId,
    listingId: parsed.listingId,
    userId: user.id,
    overrideReason: parsed.overrideReason,
  });
  if (!result.ok) {
    // Surface via query param — no error UI framework needed for the MVP.
    redirect(`/?case=${parsed.candidateCaseId}&listing=${parsed.listingId}&error=${encodeURIComponent(result.reason)}`);
  }
  revalidatePath('/');
}

export async function markRegisteredAction(formData: FormData) {
  const user = await requireUser();
  const contactAttemptId = String(formData.get('contactAttemptId'));
  await markSystemTransferRegistered({ contactAttemptId, userId: user.id });
  revalidatePath('/');
}

export async function syncCatalogAction() {
  await requireAdmin();
  await syncSeedCatalog();
  revalidatePath('/');
}
