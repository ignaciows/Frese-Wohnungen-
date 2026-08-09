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

/** "" -> null, otherwise a Date. Empty date inputs post as empty strings. */
const optionalDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v && v.trim() ? new Date(v) : null));

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
  contractSignedAt: optionalDate,
  moveInDate: optionalDate,
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
    contractSignedAt: parsed.contractSignedAt,
    moveInDate: parsed.moveInDate,
  });
  await createSearchRun(candidate.id, user.id, 'Erster Suchlauf');
  // Send the colleague straight to the next step rather than back to a list.
  redirect(`/kandidat/${candidate.id}/anschreiben`);
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
  revalidatePath('/', 'layout');
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
  moveInDate: optionalDate,
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
      moveInDate: parsed.moveInDate,
    },
    userId: user.id,
  });
  revalidatePath('/', 'layout');
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
  revalidatePath('/', 'layout');
}

export async function newSearchRunAction(formData: FormData) {
  const user = await requireUser();
  const candidateCaseId = String(formData.get('candidateCaseId'));
  await createSearchRun(candidateCaseId, user.id, 'Neuer Suchlauf');
  revalidatePath('/', 'layout');
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
  revalidatePath('/', 'layout');
}

export async function claimListingAction(formData: FormData) {
  const user = await requireUser();
  const candidateCaseId = String(formData.get('candidateCaseId'));
  const listingId = String(formData.get('listingId'));
  await claimListing({ candidateCaseId, listingId, userId: user.id });
  revalidatePath('/', 'layout');
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
  revalidatePath('/', 'layout');
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
  revalidatePath('/', 'layout');
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
    redirect(
      `/kandidat/${parsed.candidateCaseId}/ergebnisse?listing=${parsed.listingId}&error=${encodeURIComponent(
        result.reason,
      )}`,
    );
  }
  revalidatePath('/', 'layout');
  redirect(`/kandidat/${parsed.candidateCaseId}/kontakte#kontakt-${result.contactAttemptId}`);
}

/* ------------------------------------------------ reply tracking (chat) -- */

const OutcomeInput = z.object({
  contactAttemptId: z.string(),
  outcome: z.enum(['AWAITING', 'POSITIVE', 'NEGATIVE', 'NEEDS_INFO']),
  outcomeNote: z.string().max(1000).optional(),
});

export async function setContactOutcomeAction(formData: FormData) {
  const user = await requireUser();
  const parsed = OutcomeInput.parse(Object.fromEntries(formData));
  const attempt = await prisma.contactAttempt.findUniqueOrThrow({
    where: { id: parsed.contactAttemptId },
    select: { outcome: true, candidateCaseId: true, listingId: true },
  });
  await prisma.$transaction([
    prisma.contactAttempt.update({
      where: { id: parsed.contactAttemptId },
      data: {
        outcome: parsed.outcome,
        outcomeAt: parsed.outcome === 'AWAITING' ? null : new Date(),
        outcomeById: parsed.outcome === 'AWAITING' ? null : user.id,
        outcomeNote: parsed.outcomeNote || null,
      },
    }),
    prisma.auditEvent.create({
      data: {
        userId: user.id,
        candidateCaseId: attempt.candidateCaseId,
        entityType: 'ContactAttempt',
        entityId: parsed.contactAttemptId,
        action: 'contact.outcome',
        fromState: attempt.outcome,
        toState: parsed.outcome,
        reason: parsed.outcomeNote || null,
      },
    }),
  ]);
  revalidatePath('/', 'layout');
}

const ContactMessageInput = z.object({
  contactAttemptId: z.string(),
  direction: z.enum(['OUTGOING', 'INCOMING']),
  body: z.string().min(1).max(10_000),
});

export async function addContactMessageAction(formData: FormData) {
  const user = await requireUser();
  const parsed = ContactMessageInput.parse(Object.fromEntries(formData));
  await prisma.contactMessage.create({
    data: {
      contactAttemptId: parsed.contactAttemptId,
      direction: parsed.direction,
      body: parsed.body,
      recordedById: user.id,
    },
  });
  revalidatePath('/', 'layout');
}

export async function archiveCandidateAction(formData: FormData) {
  const user = await requireUser();
  const candidateCaseId = String(formData.get('candidateCaseId'));
  const archive = String(formData.get('archive')) === 'true';
  await prisma.$transaction([
    prisma.candidateCase.update({
      where: { id: candidateCaseId },
      data: { status: archive ? 'ARCHIVED' : 'ACTIVE' },
    }),
    prisma.auditEvent.create({
      data: {
        userId: user.id,
        candidateCaseId,
        entityType: 'CandidateCase',
        entityId: candidateCaseId,
        action: archive ? 'case.archive' : 'case.reactivate',
        toState: archive ? 'ARCHIVED' : 'ACTIVE',
      },
    }),
  ]);
  revalidatePath('/', 'layout');
}

export async function markRegisteredAction(formData: FormData) {
  const user = await requireUser();
  const contactAttemptId = String(formData.get('contactAttemptId'));
  await markSystemTransferRegistered({ contactAttemptId, userId: user.id });
  revalidatePath('/', 'layout');
}

export async function syncCatalogAction() {
  await requireAdmin();
  await syncSeedCatalog();
  revalidatePath('/', 'layout');
}

/* ------------------------------------------------------- appointments --- */

const AppointmentInput = z.object({
  candidateCaseId: z.string(),
  listingId: z.string().optional(),
  kind: z.enum(['VIDEO_CALL', 'VIEWING', 'PHONE_CALL', 'HANDOVER', 'OTHER']),
  scheduledAt: z.string().min(1),
  durationMinutes: z.coerce.number().int().min(5).max(600).optional(),
  location: z.string().max(512).optional(),
  notes: z.string().max(2000).optional(),
});

export async function createAppointmentAction(formData: FormData) {
  const user = await requireUser();
  const parsed = AppointmentInput.parse(Object.fromEntries(formData));
  await prisma.appointment.create({
    data: {
      candidateCaseId: parsed.candidateCaseId,
      listingId: parsed.listingId || null,
      kind: parsed.kind,
      scheduledAt: new Date(parsed.scheduledAt),
      durationMinutes: parsed.durationMinutes ?? null,
      location: parsed.location || null,
      notes: parsed.notes || null,
      createdById: user.id,
    },
  });
  revalidatePath('/', 'layout');
}

const AppointmentOutcomeInput = z.object({
  appointmentId: z.string(),
  status: z.enum(['SCHEDULED', 'DONE_POSITIVE', 'DONE_NEGATIVE', 'CANCELLED', 'NO_SHOW']),
  outcomeNote: z.string().max(2000).optional(),
});

export async function setAppointmentOutcomeAction(formData: FormData) {
  const user = await requireUser();
  const parsed = AppointmentOutcomeInput.parse(Object.fromEntries(formData));
  const appt = await prisma.appointment.findUniqueOrThrow({
    where: { id: parsed.appointmentId },
    select: { status: true, candidateCaseId: true },
  });
  await prisma.$transaction([
    prisma.appointment.update({
      where: { id: parsed.appointmentId },
      data: {
        status: parsed.status,
        outcomeNote: parsed.outcomeNote || null,
        outcomeAt: parsed.status === 'SCHEDULED' ? null : new Date(),
      },
    }),
    prisma.auditEvent.create({
      data: {
        userId: user.id,
        candidateCaseId: appt.candidateCaseId,
        entityType: 'Appointment',
        entityId: parsed.appointmentId,
        action: 'appointment.outcome',
        fromState: appt.status,
        toState: parsed.status,
      },
    }),
  ]);
  revalidatePath('/', 'layout');
}

export async function deleteAppointmentAction(formData: FormData) {
  await requireUser();
  await prisma.appointment.delete({ where: { id: String(formData.get('appointmentId')) } });
  revalidatePath('/', 'layout');
}

/* ------------------------------------------------- shared housing (WG) --- */

export async function refreshSharingAction() {
  await requireUser();
  const { refreshSharingSuggestions } = await import('@/server/sharing');
  await refreshSharingSuggestions();
  revalidatePath('/', 'layout');
}

const SharingDecisionInput = z.object({
  suggestionId: z.string(),
  status: z.enum(['ACCEPTED', 'DISMISSED']),
  dismissReason: z.string().max(500).optional(),
});

export async function decideSharingAction(formData: FormData) {
  const user = await requireUser();
  const parsed = SharingDecisionInput.parse(Object.fromEntries(formData));
  await prisma.sharedHousingSuggestion.update({
    where: { id: parsed.suggestionId },
    data: {
      status: parsed.status,
      decidedById: user.id,
      decidedAt: new Date(),
      dismissReason: parsed.dismissReason || null,
    },
  });
  revalidatePath('/', 'layout');
}

const SharingProfileInput = z.object({
  candidateCaseId: z.string(),
  openToSharing: z.coerce.boolean().default(false),
  nationality: z.string().max(64).optional(),
  languages: z.string().max(128).optional(),
});

export async function saveSharingProfileAction(formData: FormData) {
  await requireUser();
  const parsed = SharingProfileInput.parse(Object.fromEntries(formData));
  await prisma.candidateCase.update({
    where: { id: parsed.candidateCaseId },
    data: {
      openToSharing: parsed.openToSharing,
      nationality: parsed.nationality || null,
      languages: parsed.languages || null,
    },
  });
  const { refreshSharingSuggestions } = await import('@/server/sharing');
  await refreshSharingSuggestions();
  revalidatePath('/', 'layout');
}

/* ------------------------------------------------------------ settings --- */

const SharingSettingsInput = z.object({
  enabled: z.coerce.boolean().default(false),
  maxMoveInGapDays: z.coerce.number().int().min(1).max(180),
  requireSameRegion: z.coerce.boolean().default(false),
  nationalityRule: z.enum(['SAME_ONLY', 'PREFER_SAME', 'IGNORE']),
  considerLanguages: z.coerce.boolean().default(false),
  minScore: z.coerce.number().int().min(0).max(100),
});

export async function saveSharingSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = SharingSettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.sharing, parsed, user.id);
  const { refreshSharingSuggestions } = await import('@/server/sharing');
  await refreshSharingSuggestions();
  revalidatePath('/', 'layout');
}

const RecheckSettingsInput = z.object({
  recheckAfterDays: z.coerce.number().int().min(1).max(60),
  highlightNeverChecked: z.coerce.boolean().default(false),
});

export async function saveRecheckSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = RecheckSettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.sourceRecheck, parsed, user.id);
  revalidatePath('/', 'layout');
}

const TransferSettingsInput = z.object({
  objectLabel: z.string().min(1).max(64),
  linkLabel: z.string().min(1).max(64),
  locationLabel: z.string().min(1).max(64),
});

export async function saveTransferSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = TransferSettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.systemTransfer, parsed, user.id);
  revalidatePath('/', 'layout');
}

/* ------------------------------------------------------ mailbox import --- */

export async function runMailIngestAction() {
  await requireAdmin();
  const { ingestMailbox } = await import('@/server/mailIngest');
  await ingestMailbox();
  revalidatePath('/', 'layout');
}
