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
import { MAIN_SOURCE_KEYS } from '@/domain/sources/catalog';
import { RANK_VERSION } from '@/domain/ranking';

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
  // Every Anfrage earns its reminder, however it was sent.
  //
  // This used to happen only when the app posted the mail itself — and the app
  // is not allowed to until a sending address is configured, so in practice
  // nobody's enquiry ever produced a task. A colleague wrote to a landlord,
  // marked it contacted, and then had nothing anywhere telling them to look for
  // a reply. Remembering that by hand across three candidates and thirty
  // enquiries is the job this tool exists to take away.
  const { scheduleReplyCheck } = await import('@/server/followUps');
  await scheduleReplyCheck(result.contactAttemptId);

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

  if (parsed.outcome === 'POSITIVE') {
    const full = await prisma.contactAttempt.findUnique({
      where: { id: parsed.contactAttemptId },
      include: {
        candidateCase: { select: { reference: true } },
        listing: { select: { title: true } },
      },
    });
    if (full) {
      const { notifyPositiveOutcome } = await import('@/server/telegram');
      await notifyPositiveOutcome({
        candidateReference: full.candidateCase.reference,
        listingTitle: full.listing.title,
      });
    }
  }

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
  const { ingestAllMailboxes } = await import('@/server/mailIngest');
  await ingestAllMailboxes();
  revalidatePath('/', 'layout');
}

const FreshnessSettingsInput = z.object({
  newWithinHours: z.coerce.number().int().min(1).max(168),
  staleAfterDays: z.coerce.number().int().min(1).max(120),
  hideExpired: z.coerce.boolean().default(false),
});

export async function saveFreshnessSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = FreshnessSettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.freshness, parsed, user.id);
  revalidatePath('/', 'layout');
}

const BridgingSettingsInput = z.object({
  nightlyRateEuros: z.coerce.number().int().min(10).max(500),
  maxBridgeNights: z.coerce.number().int().min(1).max(180),
  idealLeadDays: z.coerce.number().int().min(0).max(90),
});

export async function saveBridgingSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = BridgingSettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(
    SETTING_KEYS.bridging,
    {
      nightlyRateCents: parsed.nightlyRateEuros * 100,
      maxBridgeNights: parsed.maxBridgeNights,
      idealLeadDays: parsed.idealLeadDays,
    },
    user.id,
  );
  revalidatePath('/', 'layout');
}

export async function markListingExpiredAction(formData: FormData) {
  const user = await requireUser();
  const listingId = String(formData.get('listingId'));
  const expired = String(formData.get('expired')) === 'true';
  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listingId },
      data: { expired, expiredAt: expired ? new Date() : null },
    }),
    prisma.auditEvent.create({
      data: {
        userId: user.id,
        entityType: 'Listing',
        entityId: listingId,
        action: expired ? 'listing.expire' : 'listing.reactivate',
        toState: expired ? 'EXPIRED' : 'ACTIVE',
      },
    }),
  ]);
  revalidatePath('/', 'layout');
}

/* ------------------------------------------------- listing link checks --- */

export async function runLivenessSweepAction() {
  await requireAdmin();
  const { runLivenessChecks } = await import('@/server/liveness');
  await runLivenessChecks();
  revalidatePath('/', 'layout');
}

export async function checkListingNowAction(formData: FormData) {
  await requireUser();
  const listingId = String(formData.get('listingId'));
  const { checkSingleListing } = await import('@/server/liveness');
  await checkSingleListing(listingId);
  revalidatePath('/', 'layout');
}

const LivenessSettingsInput = z
  .object({
    enabled: z.coerce.boolean().default(false),
    checkIntervalHours: z.coerce.number().int().min(1).max(168),
    expireAfterConsecutiveGone: z.coerce.number().int().min(1).max(5),
    maxPerRun: z.coerce.number().int().min(1).max(500),
    perHostDelayMs: z.coerce.number().int().min(500).max(30000),
    aliveAtOrAbove: z.coerce.number().int().min(51).max(100),
    goneAtOrBelow: z.coerce.number().int().min(0).max(49),
    showOnlyConfirmedActive: z.coerce.boolean().default(false),
    checkOnSearch: z.coerce.boolean().default(false),
    checkOnSearchLimit: z.coerce.number().int().min(1).max(50),
    maxBytesPerPage: z.coerce.number().int().min(16_000).max(1_000_000),
  })
  // An overlap would make an ad simultaneously confirmed and gone, and the
  // first band checked would silently win. Rejected rather than reconciled,
  // because guessing which one the admin meant is worse than saying no.
  .refine((v) => v.goneAtOrBelow < v.aliveAtOrAbove, {
    message: 'Die Schwelle für „aktiv" muss über der für „nicht mehr verfügbar" liegen.',
    path: ['aliveAtOrAbove'],
  });

const AgeFilterInput = z.object({
  maxAgeDays: z.coerce.number().int().min(0).max(365),
  hideApproximate: z.coerce.boolean().default(false),
});

export async function saveAgeFilterSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = AgeFilterInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.ageFilter, parsed, user.id);
  revalidatePath('/', 'layout');
}

/**
 * What cannot be a flat for one of our candidates.
 *
 * The bounds are deliberately editable: "impossible" is a fact about a town
 * and a year, not about the software. Anything outside them never enters the
 * pool, so nobody has to read past it.
 */
const QualityInput = z.object({
  minMonthlyEuros: z.coerce.number().int().min(0).max(2000).default(250),
  maxMonthlyEuros: z.coerce.number().int().min(300).max(20000).default(2500),
  maxRooms: z.coerce.number().int().min(1).max(20).default(6),
  minSqm: z.coerce.number().int().min(0).max(100).default(15),
  rejectShortStay: z.coerce.boolean().default(false),
});

/**
 * Narrows the automatic search to those three and switches every other source
 * off. Reversible: nothing is deleted, and any source can be switched back on
 * individually.
 */
export async function focusMainSourcesAction() {
  await requireAdmin();
  const main = await prisma.source.findMany({
    where: { key: { in: [...MAIN_SOURCE_KEYS] } },
    select: { id: true, discoveryAdapter: true },
  });
  const mainIds = main.map((s) => s.id);

  await prisma.$transaction([
    // Only the ones that can actually be searched are switched on; ImmoScout24
    // and Immowelt stay off where they have no adapter, because switching them
    // on would only produce blocked runs in the log.
    prisma.source.updateMany({
      where: { id: { in: main.filter((s) => s.discoveryAdapter).map((s) => s.id) } },
      data: { discoveryEnabled: true },
    }),
    prisma.source.updateMany({
      where: { id: { notIn: mainIds } },
      data: { discoveryEnabled: false },
    }),
  ]);
  revalidatePath('/', 'layout');
}

const MailboxInput = z.object({
  readOnly: z.coerce.boolean().default(false),
  lookbackDays: z.coerce.number().int().min(1).max(90).default(14),
});

export async function saveMailboxSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = MailboxInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.mailbox, parsed, user.id);
  revalidatePath('/', 'layout');
}

export async function saveQualitySettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = QualityInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.quality, parsed, user.id);
  revalidatePath('/', 'layout');
}

export async function saveLivenessSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = LivenessSettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.liveness, parsed, user.id);
  revalidatePath('/', 'layout');
}

/* ------------------------------------------------------- candidate edit --- */

const CandidateEditInput = z.object({
  candidateCaseId: z.string(),
  reference: z.string().min(2).max(64),
  displayName: z.string().min(2).max(128),
  notes: z.string().max(4000).optional(),
  contractSignedAt: optionalDate,
  housingSecuredAt: optionalDate,
});

export async function updateCandidateAction(formData: FormData) {
  const user = await requireUser();
  const parsed = CandidateEditInput.parse(Object.fromEntries(formData));

  const before = await prisma.candidateCase.findUniqueOrThrow({
    where: { id: parsed.candidateCaseId },
    select: { reference: true, housingSecuredAt: true },
  });

  // The reference is used to route search-agent mails, so a clash must fail
  // loudly rather than silently stealing another case's alerts.
  if (parsed.reference !== before.reference) {
    const clash = await prisma.candidateCase.findUnique({
      where: { reference: parsed.reference },
      select: { id: true },
    });
    if (clash && clash.id !== parsed.candidateCaseId) {
      redirect(`/kandidat/${parsed.candidateCaseId}/stammdaten?error=reference-taken`);
    }
  }

  await prisma.$transaction([
    prisma.candidateCase.update({
      where: { id: parsed.candidateCaseId },
      data: {
        reference: parsed.reference,
        displayName: parsed.displayName,
        notes: parsed.notes || null,
        contractSignedAt: parsed.contractSignedAt,
        housingSecuredAt: parsed.housingSecuredAt,
      },
    }),
    prisma.auditEvent.create({
      data: {
        userId: user.id,
        candidateCaseId: parsed.candidateCaseId,
        entityType: 'CandidateCase',
        entityId: parsed.candidateCaseId,
        action: 'case.update',
        fromState: before.housingSecuredAt ? 'SECURED' : 'SEARCHING',
        toState: parsed.housingSecuredAt ? 'SECURED' : 'SEARCHING',
      },
    }),
  ]);
  revalidatePath('/', 'layout');
  redirect(`/kandidat/${parsed.candidateCaseId}/stammdaten?saved=1`);
}

/**
 * Opportunistic sweep, triggered by the UI rather than an external cron.
 *
 * Waiting for infrastructure that may never be configured is how dead ads stay
 * on screen. This runs a small batch whenever someone is actually looking at
 * results, throttled through a stored timestamp so concurrent viewers cannot
 * stampede the portals.
 */
/**
 * Re-scores a candidate's matches when the ranking rules have changed since
 * they were computed.
 *
 * Scores are stored, so a rule change does not reach the ads already in the
 * pool — they keep whatever verdict the old rules gave them until something
 * touches them again. That is how a Köln candidate went on showing a Bad
 * Rappenau flat at 86 points and "Passend" after the location check landed.
 * Comparing the stored rank version against the current one makes the fix
 * arrive by opening the page, rather than by remembering to re-save a profile.
 */
export async function maybeRescoreAction(candidateCaseId: string) {
  await requireUser();
  const stale = await prisma.candidateListingMatch.findFirst({
    where: { candidateCaseId, rankVersion: { not: RANK_VERSION } },
    select: { id: true },
  });
  if (!stale) return { rescored: false as const };

  const { recomputeAllForCandidate } = await import('@/server/ranking');
  await recomputeAllForCandidate(candidateCaseId);
  revalidatePath('/', 'layout');
  return { rescored: true as const };
}

/**
 * Re-reads the ads on screen whenever somebody opens a result list.
 *
 * This is what makes the list true at the moment it is read rather than true
 * whenever a cron last ran — the original complaint was opening ads that had
 * been dead for hours. The throttle is per candidate, not global, so looking at
 * the next candidate checks *their* ads instead of being skipped because
 * somebody else's list was refreshed a minute ago.
 */
export async function maybeRunLivenessSweepAction(candidateCaseId?: string) {
  await requireUser();
  const { getLivenessSettings } = await import('@/server/settings');
  const policy = await getLivenessSettings();
  if (!policy.enabled || !policy.checkOnSearch) return { ran: false as const };

  const KEY = candidateCaseId ? `livenessLastRun:${candidateCaseId}` : 'livenessLastRun';
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const last = row ? new Date((row.valueJson as { at?: string }).at ?? 0).getTime() : 0;
  const throttleMs = 10 * 60 * 1000;
  if (Date.now() - last < throttleMs) return { ran: false as const };

  // Claim the slot before working, so two parallel page loads do not both run.
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, valueJson: { at: new Date().toISOString() } },
    update: { valueJson: { at: new Date().toISOString() } },
  });

  const { runLivenessChecks } = await import('@/server/liveness');
  // Small batch: this happens while a colleague waits, not in a cron window.
  const summary = await runLivenessChecks({
    limit: policy.checkOnSearchLimit,
    candidateCaseId,
  });
  revalidatePath('/', 'layout');
  return {
    ran: true as const,
    checked: summary.checked,
    expired: summary.expired,
    limbo: summary.limbo,
  };
}

/* ------------------------------------------------------- Wiedervorlage --- */

const FollowUpInput = z.object({
  candidateCaseId: z.string(),
  listingId: z.string(),
  followUpAt: z.string().optional(),
  followUpNote: z.string().max(500).optional(),
});

export async function setFollowUpAction(formData: FormData) {
  const user = await requireUser();
  const parsed = FollowUpInput.parse(Object.fromEntries(formData));
  await prisma.candidateListingMatch.updateMany({
    where: { candidateCaseId: parsed.candidateCaseId, listingId: parsed.listingId },
    data: {
      followUpAt: parsed.followUpAt && parsed.followUpAt.trim() ? new Date(parsed.followUpAt) : null,
      followUpNote: parsed.followUpNote || null,
    },
  });
  await prisma.auditEvent.create({
    data: {
      userId: user.id,
      candidateCaseId: parsed.candidateCaseId,
      entityType: 'CandidateListingMatch',
      entityId: parsed.listingId,
      action: parsed.followUpAt ? 'match.followUpSet' : 'match.followUpCleared',
      toState: parsed.followUpAt ?? null,
    },
  });
  revalidatePath('/', 'layout');
}

/* -------------------------------------------------- what-if simulation --- */

const SimulateInput = z.object({
  candidateCaseId: z.string(),
  maxWarmmieteEuros: z.coerce.number().int().min(100).max(10000).optional(),
  minRooms: z.coerce.number().min(0.5).max(20).optional(),
  maxCommuteMinutes: z.coerce.number().int().min(1).max(240).optional(),
  radiusKm: z.coerce.number().int().min(1).max(300).optional(),
  furnished: z.enum(['REQUIRED', 'PREFERRED', 'EITHER']).optional(),
  temporaryMode: z.coerce.boolean().optional(),
});

export async function simulateProfileAction(input: z.input<typeof SimulateInput>) {
  await requireUser();
  const parsed = SimulateInput.parse(input);
  const { loadSimulationInputs } = await import('@/server/whatif');
  const { simulate, suggestRelaxations, diagnose, blockerBreakdown, diffUnder } = await import(
    '@/domain/whatif'
  );

  const { listings, profile } = await loadSimulationInputs(parsed.candidateCaseId);

  const overrides = {
    maxWarmmieteCents: parsed.maxWarmmieteEuros != null ? parsed.maxWarmmieteEuros * 100 : undefined,
    minRooms: parsed.minRooms,
    maxCommuteMinutes: parsed.maxCommuteMinutes,
    radiusKm: parsed.radiusKm,
    furnished: parsed.furnished,
    temporaryMode: parsed.temporaryMode,
  };

  const result = simulate(listings, profile, overrides);
  const diff = diffUnder(listings, profile, overrides);

  // Only what the panel renders travels to the browser — a whole listing row
  // per ad would be a lot of payload for a slider that moves continuously.
  const slim = (l: (typeof listings)[number]) => ({
    id: l.id,
    title: l.title,
    city: l.city,
    url: l.url,
    monthlyCents: l.monthlyCents,
    rooms: l.roomCount,
    sourceName: l.sourceName,
    status: l.status,
  });

  return {
    result,
    suggestions: suggestRelaxations(listings, profile).slice(0, 5),
    diagnosis: diagnose(listings, profile),
    blockers: blockerBreakdown(listings, profile),
    totalListings: listings.length,
    preview: {
      added: diff.added.slice(0, 12).map(slim),
      removed: diff.removed.slice(0, 12).map(slim),
      addedTotal: diff.added.length,
      removedTotal: diff.removed.length,
      keptTotal: diff.kept.length,
    },
  };
}

/** Persists a simulated profile and recomputes every match for the candidate. */
export async function applySimulatedProfileAction(formData: FormData) {
  const user = await requireUser();
  const parsed = SimulateInput.parse(Object.fromEntries(formData));
  await updateSearchProfile({
    candidateCaseId: parsed.candidateCaseId,
    patch: {
      ...(parsed.maxWarmmieteEuros != null ? { maxWarmmieteCents: parsed.maxWarmmieteEuros * 100 } : {}),
      ...(parsed.minRooms != null ? { minRooms: parsed.minRooms } : {}),
      ...(parsed.maxCommuteMinutes != null ? { maxCommuteMinutes: parsed.maxCommuteMinutes } : {}),
      ...(parsed.radiusKm != null ? { radiusKm: parsed.radiusKm } : {}),
      ...(parsed.furnished != null ? { furnished: parsed.furnished } : {}),
      ...(parsed.temporaryMode != null ? { temporaryMode: parsed.temporaryMode } : {}),
    },
    userId: user.id,
  });
  revalidatePath('/', 'layout');
}

const TelegramSettingsInput = z.object({
  enabled: z.coerce.boolean().default(false),
  onReply: z.coerce.boolean().default(false),
  onPositive: z.coerce.boolean().default(false),
  onNewListings: z.coerce.boolean().default(false),
  onFollowUpDue: z.coerce.boolean().default(false),
});

export async function saveTelegramSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = TelegramSettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.telegram, parsed, user.id);
  revalidatePath('/', 'layout');
}

export async function sendTelegramTestAction() {
  await requireAdmin();
  const { sendTelegramMessage } = await import('@/server/telegram');
  await sendTelegramMessage('✅ Frese Wohnung ist mit diesem Chat verbunden.');
  revalidatePath('/', 'layout');
}

/* ==================================================== automatic discovery */

export async function runDiscoverySweepAction() {
  await requireAdmin();
  const { runDiscoverySweep } = await import('@/server/discovery');
  const summary = await runDiscoverySweep({ force: true });
  revalidatePath('/', 'layout');
  return summary;
}

/*
 * The sweep a person triggers no longer lives here.
 *
 * A server action can only answer once, at the end, and the end is up to three
 * minutes away — which is the whole complaint. `POST /api/discovery/live`
 * streams the same sweep event by event instead; see LiveSearch.tsx.
 */

const DiscoverySettingsInput = z.object({
  enabled: z.coerce.boolean().default(false),
  sweepIntervalMinutes: z.coerce.number().int().min(15).max(1440).default(90),
  maxRequestsPerRun: z.coerce.number().int().min(10).max(2000).default(120),
  perHostDelayMs: z.coerce.number().int().min(1000).max(60000).default(4000),
  maxPagesPerSource: z.coerce.number().int().min(1).max(20).default(2),
  enrichPerRun: z.coerce.number().int().min(0).max(200).default(25),
  retireAfterMissedSweeps: z.coerce.number().int().min(1).max(10).default(2),
  priceSlack: z.coerce.number().min(1).max(3).default(1.25),
});

export async function saveDiscoverySettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = DiscoverySettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.discovery, parsed, user.id);
  revalidatePath('/', 'layout');
}

const SourceDiscoveryInput = z.object({
  sourceId: z.string().min(1),
  discoveryAdapter: z.string().max(40).optional().nullable(),
  discoveryEnabled: z.coerce.boolean().default(false),
  /** Free-form JSON, or the adapter's keys as individual fields. */
  config: z.string().max(8000).optional().nullable(),
  pollIntervalMinutes: z.string().max(8).optional().nullable(),
});

/** Blank or nonsensical means "use the global interval", not "every 0 minutes". */
function pollMinutes(raw: string | null | undefined): number | null {
  const value = raw?.trim() ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 5 ? Math.round(value) : null;
}

export async function saveSourceDiscoveryAction(formData: FormData) {
  await requireAdmin();
  const parsed = SourceDiscoveryInput.parse(Object.fromEntries(formData));

  let config: Record<string, unknown> = {};
  if (parsed.config?.trim()) {
    try {
      const decoded = JSON.parse(parsed.config) as unknown;
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        config = decoded as Record<string, unknown>;
      }
    } catch {
      // Malformed JSON must not silently wipe a working configuration.
      return { ok: false as const, error: 'Konfiguration ist kein gültiges JSON.' };
    }
  }

  await prisma.source.update({
    where: { id: parsed.sourceId },
    data: {
      discoveryAdapter: parsed.discoveryAdapter?.trim() || null,
      discoveryEnabled: parsed.discoveryEnabled,
      discoveryConfig: config as never,
      pollIntervalMinutes: pollMinutes(parsed.pollIntervalMinutes),
      // A configuration change invalidates the previous verdict.
      discoveryStatus: null,
      discoveryNote: null,
    },
  });
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

/**
 * Switch one source on or off, and nothing else.
 *
 * The settings page used to put every source in its own form behind its own
 * Speichern button. Ticking the boxes and moving on — which is what the page
 * looked like it wanted — saved nothing at all, so the automatic search sat
 * there with no sources and found nothing, while the screen showed every box
 * ticked. A switch that only writes when you press a second, separate button
 * is not a switch.
 */
export async function toggleSourceAction(sourceId: string, enabled: boolean) {
  await requireAdmin();
  await prisma.source.update({
    where: { id: sourceId },
    data: {
      discoveryEnabled: enabled,
      // Re-asking is the point of switching it back on; the old verdict was
      // about a different question.
      ...(enabled ? { discoveryStatus: null, discoveryNote: null } : {}),
    },
  });
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

/** Saves the automatic-search numbers as they are edited. */
export async function saveDiscoverySettingsPatchAction(patch: Record<string, string>) {
  const user = await requireAdmin();
  const { getDiscoverySettings, writeSetting, SETTING_KEYS } = await import('@/server/settings');
  const current = await getDiscoverySettings();
  // Merged onto what is stored, so saving one field cannot blank the others —
  // the failure mode of an autosaving form that posts only what it touched.
  const merged = DiscoverySettingsInput.parse({
    ...toFormShape(current as unknown as Record<string, unknown>),
    ...patch,
  });
  await writeSetting(SETTING_KEYS.discovery, merged, user.id);
  revalidatePath('/', 'layout');
  return { ok: true as const };
}

/**
 * The stored settings in the shape a form would post them.
 *
 * Booleans need the care: the schema coerces, and `z.coerce.boolean()` reads
 * the *string* "false" as true, because it is a non-empty string. Stringifying
 * naively would therefore switch the automatic search on every time any other
 * field was saved.
 */
function toFormShape(s: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) out[k] = typeof v === 'boolean' ? (v ? 'true' : '') : String(v);
  return out;
}

/* ========================================================= portal accounts */

const AccountInput = z.object({
  id: z.string().optional(),
  kind: z.enum(['PORTAL', 'MAILBOX']).default('PORTAL'),
  // Optional here, filled in from the chosen portal below. Asking a colleague
  // to invent a "Kennung" for a portal they just picked from a list is asking
  // them to do the database's bookkeeping.
  siteKey: z.string().max(80).optional(),
  sourceId: z.string().optional().nullable(),
  label: z.string().max(120).optional(),
  loginName: z.string().max(200).optional().nullable(),
  secret: z.string().max(400).optional(),
  secondarySecret: z.string().max(400).optional(),
  replyToAddress: z.string().max(200).optional().nullable(),
  smtpHost: z.string().max(200).optional().nullable(),
  smtpPort: z.string().max(6).optional().nullable(),
  imapHost: z.string().max(200).optional().nullable(),
  imapPort: z.string().max(6).optional().nullable(),
  profileUrl: z.string().max(400).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  active: z.coerce.boolean().default(true),
  /** Preset that fills in the servers; see MAIL_PROVIDERS. */
  provider: z.string().max(40).optional().nullable(),
  authMethod: z.enum(['PASSWORD', 'APP_PASSWORD', 'IMAP_ONLY']).optional(),
});

/**
 * Server addresses for the providers this team actually uses.
 *
 * Nobody should have to look up `imap.gmail.com` to connect a mailbox, and a
 * mistyped hostname fails in a way that looks like a wrong password. The
 * free-text fields stay for everyone else.
 */
const MAIL_PROVIDERS: Record<
  string,
  { imapHost: string; imapPort: string; smtpHost: string; smtpPort: string }
> = {
  gmail: { imapHost: 'imap.gmail.com', imapPort: '993', smtpHost: 'smtp.gmail.com', smtpPort: '587' },
  outlook: {
    imapHost: 'outlook.office365.com',
    imapPort: '993',
    smtpHost: 'smtp.office365.com',
    smtpPort: '587',
  },
  ionos: { imapHost: 'imap.ionos.de', imapPort: '993', smtpHost: 'smtp.ionos.de', smtpPort: '587' },
  strato: { imapHost: 'imap.strato.de', imapPort: '993', smtpHost: 'smtp.strato.de', smtpPort: '587' },
  webde: { imapHost: 'imap.web.de', imapPort: '993', smtpHost: 'smtp.web.de', smtpPort: '587' },
  gmx: { imapHost: 'imap.gmx.net', imapPort: '993', smtpHost: 'mail.gmx.net', smtpPort: '587' },
};

export async function saveAccountAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = AccountInput.parse(Object.fromEntries(formData));
  const { saveAccount } = await import('@/server/portalAccounts');

  // Derive the identifier and the display name from the portal that was
  // chosen, so the form only has to ask for the two things a person actually
  // has: a username and a password.
  const source = parsed.sourceId
    ? await prisma.source.findUnique({
        where: { id: parsed.sourceId },
        select: { key: true, name: true },
      })
    : null;
  // A mailbox needs no portal: its identifier is the address itself, which
  // also keeps several mailboxes apart under the (siteKey, label) key.
  const siteKey =
    (parsed.siteKey?.trim() || source?.key || (parsed.kind === 'MAILBOX' ? 'mailbox' : '')).trim();
  if (!siteKey) {
    return { ok: false as const, error: 'Bitte ein Portal auswählen.' };
  }

  // Hand-typed servers win; the preset only fills what was left empty.
  const preset = parsed.provider ? MAIL_PROVIDERS[parsed.provider] : undefined;
  const imapHost = parsed.imapHost?.trim() || preset?.imapHost || null;
  const imapPort = parsed.imapPort?.trim() || preset?.imapPort || null;
  const smtpHost = parsed.smtpHost?.trim() || preset?.smtpHost || null;
  const smtpPort = parsed.smtpPort?.trim() || preset?.smtpPort || null;

  if (parsed.kind === 'MAILBOX' && !imapHost && !smtpHost) {
    return {
      ok: false as const,
      error:
        'Für ein Postfach fehlen die Serveradressen. Entweder einen Anbieter auswählen oder IMAP/SMTP von Hand eintragen.',
    };
  }

  const result = await saveAccount({
    id: parsed.id || undefined,
    kind: parsed.kind,
    siteKey,
    sourceId: parsed.sourceId || null,
    label: parsed.label?.trim() || source?.name || siteKey,
    loginName: parsed.loginName,
    // An empty password field means "leave it alone", not "delete it" —
    // otherwise editing a label would silently wipe the credential.
    secret: parsed.secret ? parsed.secret : undefined,
    secondarySecret: parsed.secondarySecret ? parsed.secondarySecret : undefined,
    replyToAddress: parsed.replyToAddress,
    meta: {
      smtpHost,
      smtpPort,
      imapHost,
      imapPort,
      authMethod: parsed.authMethod ?? null,
      provider: parsed.provider || null,
      profileUrl: parsed.profileUrl || null,
      note: parsed.note || null,
    },
    active: parsed.active,
    userId: user.id,
  });

  revalidatePath('/einstellungen');
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.reason };
}

export async function deleteAccountAction(formData: FormData) {
  const user = await requireAdmin();
  const id = z.string().min(1).parse(formData.get('id'));
  const { deleteAccount } = await import('@/server/portalAccounts');
  await deleteAccount(id, user.id);
  revalidatePath('/einstellungen');
}

export async function verifyMailboxAction(accountId?: string) {
  await requireAdmin();
  const { verifyMailbox } = await import('@/server/outbound');
  const result = await verifyMailbox(accountId);
  revalidatePath('/einstellungen');
  return result;
}

const OutboundSettingsInput = z.object({
  enabled: z.coerce.boolean().default(false),
  fromName: z.string().max(120).default('Frese Recruiting GmbH'),
  fromAddress: z.string().max(200).default(''),
  subjectTemplate: z.string().max(200).default('Anfrage zu Ihrer Wohnung: {title}'),
  maxPerHour: z.coerce.number().int().min(1).max(200).default(20),
});

export async function saveOutboundSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = OutboundSettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.outbound, parsed, user.id);
  revalidatePath('/', 'layout');
}

const FollowUpSettingsInput = z.object({
  checkReplyAfterDays: z.coerce.number().int().min(1).max(30).default(3),
  secondCheckAfterDays: z.coerce.number().int().min(0).max(30).default(4),
  autoCreate: z.coerce.boolean().default(true),
});

export async function saveFollowUpSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const parsed = FollowUpSettingsInput.parse(Object.fromEntries(formData));
  const { writeSetting, SETTING_KEYS } = await import('@/server/settings');
  await writeSetting(SETTING_KEYS.followUp, parsed, user.id);
  revalidatePath('/', 'layout');
}

/* ================================================ sending from the app */

export async function sendAnfrageAction(formData: FormData) {
  const user = await requireUser();
  const input = z
    .object({
      candidateCaseId: z.string().min(1),
      listingId: z.string().min(1),
      bodyOverride: z.string().max(20000).optional(),
      overrideReason: z.string().max(500).optional(),
    })
    .parse(Object.fromEntries(formData));

  const { sendAnfrage } = await import('@/server/outbound');
  const result = await sendAnfrage({
    candidateCaseId: input.candidateCaseId,
    listingId: input.listingId,
    userId: user.id,
    bodyOverride: input.bodyOverride,
    overrideReason: input.overrideReason || undefined,
  });

  revalidatePath('/', 'layout');
  return result;
}

export async function retrySendAction(formData: FormData) {
  const user = await requireUser();
  const id = z.string().min(1).parse(formData.get('contactAttemptId'));
  const { retrySend } = await import('@/server/outbound');
  const result = await retrySend(id, user.id);
  revalidatePath('/', 'layout');
  return result;
}

/**
 * Same retry, but returning nothing so it can be a plain `<form action>`.
 * A failure is reported through the notification list rather than a return
 * value the form has no way to render.
 */
export async function retrySendFormAction(formData: FormData) {
  const result = await retrySendAction(formData);
  if (!result.ok) {
    const { notify } = await import('@/server/followUps');
    await notify({
      kind: 'SEND_FAILED',
      title: 'Erneuter Versand fehlgeschlagen',
      body: result.reason ?? null,
      contactAttemptId: String(formData.get('contactAttemptId') ?? '') || null,
    });
    revalidatePath('/', 'layout');
  }
}

/* ============================================== tasks and notifications */

export async function completeTaskAction(formData: FormData) {
  const user = await requireUser();
  const parsed = z
    .object({ id: z.string().min(1), state: z.enum(['DONE', 'DISMISSED']).default('DONE') })
    .parse(Object.fromEntries(formData));
  const { completeTask } = await import('@/server/followUps');
  await completeTask(parsed.id, user.id, parsed.state);
  revalidatePath('/', 'layout');
}

export async function markNotificationsReadAction(formData?: FormData) {
  await requireUser();
  const raw = formData?.get('ids');
  const ids = typeof raw === 'string' && raw ? raw.split(',').filter(Boolean) : undefined;
  const { markNotificationsRead } = await import('@/server/followUps');
  await markNotificationsRead(ids);
  revalidatePath('/', 'layout');
}

export async function markRepliesReadAction(formData: FormData) {
  await requireUser();
  const attemptId = z.string().min(1).parse(formData.get('contactAttemptId'));
  await prisma.contactMessage.updateMany({
    where: { contactAttemptId: attemptId, direction: 'INCOMING', readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath('/', 'layout');
}

/* --------------------------------------------------- form-safe wrappers */

/**
 * `<form action>` requires an action that resolves to nothing, so these thin
 * wrappers run the real action and report a failure by redirecting back with a
 * readable message. Returning the error object instead would leave the form
 * with a value it cannot render.
 */
export async function saveAccountFormAction(formData: FormData) {
  const result = await saveAccountAction(formData);
  if (!result.ok) {
    redirect(`/einstellungen?fehler=${encodeURIComponent(result.error)}`);
  }
  redirect('/einstellungen?gespeichert=konto');
}

export async function saveSourceDiscoveryFormAction(formData: FormData) {
  const result = await saveSourceDiscoveryAction(formData);
  if (!result.ok) {
    redirect(`/einstellungen?fehler=${encodeURIComponent(result.error)}`);
  }
  redirect('/einstellungen?gespeichert=quelle');
}

export async function verifyPortalAccountFormAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const { verifyPortalAccount } = await import('@/server/portalAccounts');
  const result = await verifyPortalAccount(id);
  revalidatePath('/', 'layout');
  redirect(
    result.ok
      ? `/einstellungen?gespeichert=${encodeURIComponent(result.message)}`
      : `/einstellungen?fehler=${encodeURIComponent(result.message)}`,
  );
}

export async function verifyMailboxFormAction(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim();
  const result = await verifyMailboxAction(id || undefined);
  redirect(
    result.ok
      ? `/einstellungen?gespeichert=${encodeURIComponent(result.message)}`
      : `/einstellungen?fehler=${encodeURIComponent(result.message)}`,
  );
}

export async function runDiscoverySweepFormAction() {
  const summary = await runDiscoverySweepAction();
  const note = summary.skippedReason
    ? summary.skippedReason
    : `${summary.created} neu, ${summary.updated} bestätigt, ${summary.retired} entfernt (${summary.requests} Abrufe).`;
  redirect(`/einstellungen?gespeichert=${encodeURIComponent(note)}`);
}

/* ------------------------------------------------- add any source by URL */

/**
 * Probes a website and reports how — or whether — it can be read
 * automatically. This is what makes the long tail of municipal landlords,
 * cooperatives and regional agents addable without a developer.
 */
export async function probeSourceAction(formData: FormData) {
  await requireAdmin();
  const url = z.string().url().max(500).parse(String(formData.get('url') ?? '').trim());
  const { probeSource } = await import('@/server/sourceProbe');
  const report = await probeSource(url);
  return report;
}

const NewSourceInput = z.object({
  name: z.string().min(2).max(120),
  websiteUrl: z.string().url().max(500),
  category: z
    .enum([
      'MARKETPLACE',
      'GENERAL_PORTAL',
      'FURNISHED',
      'INSTITUTIONAL_LANDLORD',
      'COOPERATIVE',
      'MUNICIPAL',
      'TEMPORARY',
      'SOCIAL_LOCAL',
      'DIRECTORY',
    ])
    .default('GENERAL_PORTAL'),
  discoveryAdapter: z.string().max(40).optional().nullable(),
  config: z.string().max(8000).optional().nullable(),
  pollIntervalMinutes: z.coerce.number().int().min(5).max(10080).optional().nullable(),
  enable: z.coerce.boolean().default(false),
});

/** Creates a source from the probe result (or by hand). */
export async function createSourceAction(formData: FormData) {
  await requireAdmin();
  const parsed = NewSourceInput.parse(Object.fromEntries(formData));

  let config: Record<string, unknown> = {};
  if (parsed.config?.trim()) {
    try {
      const decoded = JSON.parse(parsed.config) as unknown;
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        config = decoded as Record<string, unknown>;
      }
    } catch {
      return { ok: false as const, error: 'Konfiguration ist kein gültiges JSON.' };
    }
  }

  // A readable, stable key derived from the name; collisions get a suffix
  // rather than silently overwriting somebody else's source.
  const base =
    parsed.name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'quelle';
  let key = base;
  for (let i = 2; await prisma.source.findUnique({ where: { key } }); i++) {
    key = `${base}-${i}`;
  }

  await prisma.source.create({
    data: {
      key,
      name: parsed.name,
      websiteUrl: parsed.websiteUrl,
      category: parsed.category,
      priority: 200,
      integrationMode: 'CUSTOM_SOURCE',
      // Added by hand after a probe, so the admin has seen what it does.
      termsReviewStatus: 'MANUAL_ONLY',
      housingTypes: ['APARTMENT'],
      discoveryAdapter: parsed.discoveryAdapter?.trim() || null,
      discoveryEnabled: parsed.enable,
      discoveryConfig: config as never,
      pollIntervalMinutes: parsed.pollIntervalMinutes ?? null,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true as const, key };
}

export async function createSourceFormAction(formData: FormData) {
  const result = await createSourceAction(formData);
  redirect(
    result.ok
      ? `/einstellungen?gespeichert=${encodeURIComponent(`Quelle „${formData.get('name')}" angelegt.`)}`
      : `/einstellungen?fehler=${encodeURIComponent(result.error)}`,
  );
}

const SourcePollInput = z.object({
  sourceId: z.string().min(1),
  pollIntervalMinutes: z.string().max(8).optional().nullable(),
});

export async function saveSourcePollAction(formData: FormData) {
  await requireAdmin();
  const parsed = SourcePollInput.parse(Object.fromEntries(formData));
  const raw = parsed.pollIntervalMinutes?.trim();
  const minutes = raw ? Number(raw) : null;
  await prisma.source.update({
    where: { id: parsed.sourceId },
    data: {
      pollIntervalMinutes:
        minutes != null && Number.isFinite(minutes) && minutes >= 5 ? Math.round(minutes) : null,
    },
  });
  revalidatePath('/einstellungen');
}
