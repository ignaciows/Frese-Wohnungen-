/**
 * Turns the pure matching rules into stored, actionable suggestions.
 * Nothing here contacts anybody — a colleague always decides.
 */

import { prisma } from '@/lib/prisma';
import { findSharingSuggestions, type SharingCandidate } from '@/domain/sharing';
import { regionKeyFor } from '@/domain/priority';
import { getSharingSettings } from './settings';

async function loadCandidates(): Promise<SharingCandidate[]> {
  const cases = await prisma.candidateCase.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      reference: true,
      displayName: true,
      openToSharing: true,
      nationality: true,
      languages: true,
      housingSecuredAt: true,
      searchProfile: {
        select: {
          moveInDate: true,
          workplacePostalCode: true,
          workplaceCity: true,
          maxWarmmieteCents: true,
          adults: true,
          children: true,
        },
      },
    },
  });

  return cases.map((c) => ({
    id: c.id,
    reference: c.reference,
    displayName: c.displayName,
    openToSharing: c.openToSharing,
    nationality: c.nationality,
    languages: c.languages,
    moveInDate: c.searchProfile?.moveInDate ?? null,
    regionKey: regionKeyFor(
      c.searchProfile?.workplacePostalCode ?? null,
      c.searchProfile?.workplaceCity ?? null,
    ),
    workplaceCity: c.searchProfile?.workplaceCity ?? null,
    maxWarmmieteCents: c.searchProfile?.maxWarmmieteCents ?? 0,
    adults: c.searchProfile?.adults ?? 1,
    children: c.searchProfile?.children ?? 0,
    housingSecured: c.housingSecuredAt != null,
  }));
}

/**
 * Recomputes suggestions. Pairs a colleague already dismissed or accepted keep
 * their decision — we never re-propose something that was answered.
 */
export async function refreshSharingSuggestions(): Promise<number> {
  const [settings, candidates] = await Promise.all([getSharingSettings(), loadCandidates()]);
  const suggestions = findSharingSuggestions(candidates, settings);

  const existing = await prisma.sharedHousingSuggestion.findMany();
  const decided = new Set(
    existing.filter((e) => e.status !== 'PROPOSED').map((e) => `${e.caseAId}|${e.caseBId}`),
  );

  let written = 0;
  for (const s of suggestions) {
    if (decided.has(`${s.aId}|${s.bId}`)) continue;
    await prisma.sharedHousingSuggestion.upsert({
      where: { caseAId_caseBId: { caseAId: s.aId, caseBId: s.bId } },
      create: {
        caseAId: s.aId,
        caseBId: s.bId,
        score: s.score,
        reasons: s.reasons as never,
      },
      update: { score: s.score, reasons: s.reasons as never },
    });
    written++;
  }

  // Drop stale open suggestions that no longer qualify (e.g. dates changed).
  const stillValid = new Set(suggestions.map((s) => `${s.aId}|${s.bId}`));
  const obsolete = existing.filter(
    (e) => e.status === 'PROPOSED' && !stillValid.has(`${e.caseAId}|${e.caseBId}`),
  );
  if (obsolete.length > 0) {
    await prisma.sharedHousingSuggestion.deleteMany({
      where: { id: { in: obsolete.map((o) => o.id) } },
    });
  }

  return written;
}

export async function loadOpenSuggestions() {
  return prisma.sharedHousingSuggestion.findMany({
    where: { status: 'PROPOSED' },
    orderBy: { score: 'desc' },
    include: {
      caseA: { select: { id: true, displayName: true, reference: true, searchProfile: true } },
      caseB: { select: { id: true, displayName: true, reference: true, searchProfile: true } },
    },
  });
}
