/**
 * Create a SearchRun from a candidate's profile. Plans one task per relevant
 * source (including manual-only sources) and snapshots the profile + mappings
 * so history is stable when the config later changes.
 */

import { prisma } from '@/lib/prisma';
import { planSearchRun, type PlannerSource } from '@/domain/sources/planner';
import type { CanonicalFilterValues } from '@/domain/sources/recipe';

export async function createSearchRun(candidateCaseId: string, userId: string, label = 'Neuer Suchlauf') {
  const candidate = await prisma.candidateCase.findUniqueOrThrow({
    where: { id: candidateCaseId },
    include: { searchProfile: true },
  });
  if (!candidate.searchProfile) throw new Error('Kandidat hat noch kein Suchprofil.');

  const p = candidate.searchProfile;
  const values: CanonicalFilterValues = {
    location: {
      city: p.workplaceCity,
      postalCode: p.workplacePostalCode,
      address: p.workplaceAddress,
    },
    radiusKm: p.radiusKm,
    commuteMinutes: p.maxCommuteMinutes,
    maxWarmmieteCents: p.maxWarmmieteCents,
    minRooms: p.minRooms,
    propertyType: p.temporaryMode ? 'TEMPORARY' : 'APARTMENT',
    furnished: p.furnished,
    wbs: p.wbsStatus,
    minLivingSpace: null,
    availableFrom: p.moveInDate,
    pets: p.pets,
  };

  const sources = await prisma.source.findMany({
    where: { active: true },
    include: { filterMappings: true },
    orderBy: { priority: 'asc' },
  });

  const plannerSources: PlannerSource[] = sources.map((s) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    active: s.active,
    filterMappings: s.filterMappings.map((m) => ({
      canonicalFilter: m.canonicalFilter,
      quality: m.quality,
      portalLabel: m.portalLabel,
      note: m.note,
    })),
  }));

  const report = planSearchRun(plannerSources, values);

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.searchRun.create({
      data: {
        candidateCaseId,
        createdById: userId,
        label,
        profileSnapshot: {
          workplaceAddress: p.workplaceAddress,
          workplaceCity: p.workplaceCity,
          workplacePostalCode: p.workplacePostalCode,
          maxWarmmieteCents: p.maxWarmmieteCents,
          minRooms: p.minRooms,
          preferredRooms: p.preferredRooms,
          furnished: p.furnished,
          maxCommuteMinutes: p.maxCommuteMinutes,
          radiusKm: p.radiusKm,
          wbsStatus: p.wbsStatus,
          temporaryMode: p.temporaryMode,
          adults: p.adults,
          children: p.children,
        },
      },
    });
    for (const task of report.planned) {
      await tx.sourceCheck.create({
        data: {
          searchRunId: created.id,
          sourceId: task.sourceId,
          status: 'PENDING',
          mappingSnapshot: task.mappingSnapshot as unknown as object,
          recipeSnapshot: task.recipeSnapshot as unknown as object,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        userId,
        candidateCaseId,
        entityType: 'SearchRun',
        entityId: created.id,
        action: 'searchRun.create',
        meta: { plannedCount: report.planned.length, skippedCount: report.skipped.length },
      },
    });
    return created;
  });

  return { runId: run.id, planned: report.planned, skipped: report.skipped };
}

export async function updateSourceCheckStatus(input: {
  sourceCheckId: string;
  userId: string;
  status:
    | 'PENDING'
    | 'IN_PROGRESS'
    | 'CHECKED_NO_RESULTS'
    | 'CHECKED_RESULTS_IMPORTED'
    | 'UNAVAILABLE'
    | 'SKIPPED';
  note?: string;
  unavailableReason?: string;
}) {
  return prisma.sourceCheck.update({
    where: { id: input.sourceCheckId },
    data: {
      status: input.status,
      lastCheckedAt:
        input.status === 'PENDING' || input.status === 'IN_PROGRESS' ? undefined : new Date(),
      checkedById:
        input.status === 'PENDING' || input.status === 'IN_PROGRESS' ? undefined : input.userId,
      note: input.note,
      unavailableReason: input.unavailableReason,
    },
  });
}
