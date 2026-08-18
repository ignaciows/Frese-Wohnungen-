/**
 * Candidate case + search profile helpers. Keeps data-minimisation front and
 * centre: nothing here reads or stores any candidate PII beyond what the
 * search actually requires.
 */

import { prisma } from '@/lib/prisma';
import { recomputeAllForCandidate } from './ranking';

export interface CreateCandidateInput {
  reference: string;
  displayName: string;
  notes?: string;
  createdById: string;
  /** Klinik, Pflegeheim oder Träger — wo die Kandidatin arbeiten wird. */
  employer?: string | null;
  workplace: {
    address: string;
    city?: string | null;
    postalCode?: string | null;
    lat?: number | null;
    lon?: number | null;
  };
  maxWarmmieteCents?: number;
  minRooms?: number;
  preferredRooms?: number;
  adults?: number;
  children?: number;
  furnished?: 'REQUIRED' | 'PREFERRED' | 'EITHER';
  maxCommuteMinutes?: number | null;
  radiusKm?: number | null;
  wbsStatus?: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
  temporaryMode?: boolean;
  moveInDate?: Date | null;
  pets?: string | null;
  /// Contract signature date in the existing Frese system — starts the search clock.
  contractSignedAt?: Date | null;
}

export async function createCandidateCase(input: CreateCandidateInput) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.candidateCase.create({
      data: {
        reference: input.reference,
        contractSignedAt: input.contractSignedAt ?? null,
        displayName: input.displayName,
        notes: input.notes,
        createdById: input.createdById,
        applicationMessage: { create: { body: '' } },
        searchProfile: {
          create: {
            employer: input.employer ?? null,
            workplaceAddress: input.workplace.address,
            workplaceCity: input.workplace.city ?? null,
            workplacePostalCode: input.workplace.postalCode ?? null,
            workplaceLat: input.workplace.lat ?? null,
            workplaceLon: input.workplace.lon ?? null,
            geocodeStatus: input.workplace.lat != null ? 'MANUAL' : 'UNKNOWN',
            maxWarmmieteCents: input.maxWarmmieteCents ?? 90000,
            minRooms: input.minRooms ?? 1,
            preferredRooms: input.preferredRooms ?? 2,
            adults: input.adults ?? 1,
            children: input.children ?? 0,
            furnished: input.furnished ?? 'PREFERRED',
            maxCommuteMinutes: input.maxCommuteMinutes ?? 35,
            radiusKm: input.radiusKm ?? null,
            wbsStatus: input.wbsStatus ?? 'UNKNOWN',
            temporaryMode: input.temporaryMode ?? false,
            moveInDate: input.moveInDate ?? null,
            pets: input.pets ?? null,
          },
        },
      },
    });
    await tx.auditEvent.create({
      data: {
        userId: input.createdById,
        candidateCaseId: candidate.id,
        entityType: 'CandidateCase',
        entityId: candidate.id,
        action: 'candidate.create',
      },
    });
    return candidate;
  });
}

export async function updateApplicationMessage(input: {
  candidateCaseId: string;
  body: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.applicationMessage.findUnique({
      where: { candidateCaseId: input.candidateCaseId },
    });
    if (!existing) {
      return tx.applicationMessage.create({
        data: { candidateCaseId: input.candidateCaseId, body: input.body, updatedById: input.userId, revision: 1 },
      });
    }
    return tx.applicationMessage.update({
      where: { candidateCaseId: input.candidateCaseId },
      data: { body: input.body, updatedById: input.userId, revision: { increment: 1 } },
    });
  });
}

export async function updateSearchProfile(input: {
  candidateCaseId: string;
  patch: Partial<{
    employer?: string | null;
    workplaceAddress: string;
    workplaceCity: string | null;
    workplacePostalCode: string | null;
    workplaceLat: number | null;
    workplaceLon: number | null;
    maxWarmmieteCents: number;
    minRooms: number;
    preferredRooms: number;
    adults: number;
    children: number;
    furnished: 'REQUIRED' | 'PREFERRED' | 'EITHER';
    maxCommuteMinutes: number | null;
    radiusKm: number | null;
    wbsStatus: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
    temporaryMode: boolean;
    moveInDate: Date | null;
    pets: string | null;
  }>;
  userId: string;
}) {
  const updated = await prisma.searchProfile.update({
    where: { candidateCaseId: input.candidateCaseId },
    data: input.patch,
  });
  await prisma.auditEvent.create({
    data: {
      userId: input.userId,
      candidateCaseId: input.candidateCaseId,
      entityType: 'SearchProfile',
      entityId: updated.id,
      action: 'profile.update',
    },
  });
  await recomputeAllForCandidate(input.candidateCaseId);
  return updated;
}
