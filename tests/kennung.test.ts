/**
 * Einen zweiten Fall anlegen, nachdem ein erster gelöscht wurde.
 *
 * Die Kennung ordnet Suchagent-Mails dem richtigen Fall zu und ist deshalb
 * eindeutig. Vorgeschlagen wurde sie aus der Anzahl der Fälle: bei drei Fällen
 * „CAND-2026-004". Löscht jemand einen davon, zeigt dieselbe Rechnung auf
 * „CAND-2026-003" — eine Kennung, die es schon gibt. Das Anlegen brach dann in
 * der Datenbank ab, und auf dem Bildschirm stand ein leeres Weiß mit
 * „Application error … Digest: 3610855577". Der Fall ließ sich nicht mehr
 * anlegen, und nichts sagte, woran es lag.
 *
 * Die Kennung ist eine interne Nummer. Ist sie vergeben, wird die nächste
 * genommen — hier steht, dass sie das tut.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

async function fall(reference: string) {
  const { hashPassword } = await import('@/lib/auth');
  const { createCandidateCase } = await import('@/server/candidates');
  const user =
    (await prisma.user.findFirst()) ??
    (await prisma.user.create({
      data: {
        email: 'kennung@test.local',
        name: 'Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword('test-pw-1234'),
      },
    }));
  return createCandidateCase({
    reference,
    displayName: 'Prüfkandidatin',
    createdById: user.id,
    workplace: { address: '22143 Hamburg', city: 'Hamburg', postalCode: '22143' },
    radiusKm: 10,
  });
}

describe('freie Kennung', () => {
  it('lässt eine unbenutzte Kennung, wie sie ist', async () => {
    const { nextFreeReference } = await import('@/server/candidates');
    expect(await nextFreeReference('CAND-2026-001')).toBe('CAND-2026-001');
  });

  it('nimmt die nächste, wenn die gewünschte vergeben ist', async () => {
    const { nextFreeReference } = await import('@/server/candidates');
    await fall('CAND-2026-001');
    expect(await nextFreeReference('CAND-2026-001')).toBe('CAND-2026-002');
  });

  it('zählt über die höchste vergebene, nicht über die Anzahl', async () => {
    // Genau der Fall aus der Produktion: drei angelegt, einer gelöscht.
    const { nextFreeReference } = await import('@/server/candidates');
    await fall('CAND-2026-001');
    const zweiter = await fall('CAND-2026-002');
    await fall('CAND-2026-003');
    await prisma.candidateCase.delete({ where: { id: zweiter.id } });

    // Die alte Rechnung (Anzahl + 1) ergibt hier „003" — vergeben.
    expect(await prisma.candidateCase.count()).toBe(2);
    expect(await nextFreeReference('CAND-2026-003')).toBe('CAND-2026-004');
  });

  it('behält die Stellenzahl bei', async () => {
    const { nextFreeReference } = await import('@/server/candidates');
    await fall('CAND-2026-009');
    expect(await nextFreeReference('CAND-2026-009')).toBe('CAND-2026-010');
  });

  it('hängt eine Zahl an, wenn die Kennung auf keine endet', async () => {
    const { nextFreeReference } = await import('@/server/candidates');
    await fall('PFLEGE-HAMBURG');
    expect(await nextFreeReference('PFLEGE-HAMBURG')).toBe('PFLEGE-HAMBURG-01');
  });

  it('verwechselt zwei Jahrgänge nicht', async () => {
    const { nextFreeReference } = await import('@/server/candidates');
    await fall('CAND-2025-007');
    expect(await nextFreeReference('CAND-2026-001')).toBe('CAND-2026-001');
  });
});
