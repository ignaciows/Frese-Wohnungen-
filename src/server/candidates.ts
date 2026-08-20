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

/**
 * Eine freie Kennung, ausgehend von der gewünschten.
 *
 * Die Kennung ist eindeutig, weil Suchagent-Mails darüber dem richtigen Fall
 * zugeordnet werden. Vorgeschlagen wurde sie aus der Anzahl der Fälle — und
 * nach dem ersten gelöschten Fall zeigt eine Zählung auf eine Nummer, die es
 * schon gibt. Das Anlegen brach dann mit einer Datenbankmeldung ab, die auf
 * dem Bildschirm als „Application error" ankam: der Fall ließ sich nicht mehr
 * anlegen, und nichts sagte, woran es lag.
 *
 * Die Kennung ist eine interne Nummer. Ist sie vergeben, wird die nächste
 * genommen, statt jemanden raten zu lassen.
 */
const NUMBERED = /^(.*?)(\d+)$/;

export async function nextFreeReference(wanted: string): Promise<string> {
  const trimmed = wanted.trim();
  const taken = await prisma.candidateCase.count({ where: { reference: trimmed } });
  if (taken === 0) return trimmed;

  const m = NUMBERED.exec(trimmed);
  const prefix = m ? m[1] : `${trimmed}-`;
  const width = m ? m[2].length : 2;

  const siblings = await prisma.candidateCase.findMany({
    where: { reference: { startsWith: prefix } },
    select: { reference: true },
  });
  let highest = 0;
  for (const s of siblings) {
    const n = NUMBERED.exec(s.reference);
    if (n && n[1] === prefix) highest = Math.max(highest, Number(n[2]));
  }
  return `${prefix}${String(highest + 1).padStart(width, '0')}`;
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
            // RESOLVED, not MANUAL: these coordinates came from the address
            // lookup, not from somebody typing numbers in by hand.
            geocodeStatus: input.workplace.lat != null ? 'RESOLVED' : 'UNKNOWN',
            maxWarmmieteCents: input.maxWarmmieteCents ?? 90000,
            minRooms: input.minRooms ?? 1,
            preferredRooms: input.preferredRooms ?? 2,
            adults: input.adults ?? 1,
            children: input.children ?? 0,
            furnished: input.furnished ?? 'PREFERRED',
            // Explicit null wins: a profile that carries a radius must not also
            // carry a 35-minute default, or the ranking judges on the minutes —
            // the number nobody chose.
            maxCommuteMinutes:
              input.maxCommuteMinutes === null
                ? null
                : (input.maxCommuteMinutes ?? (input.radiusKm != null ? null : 35)),
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
    /** RESOLVED once the address came from the lookup rather than a keyboard. */
    geocodeStatus: string;
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
