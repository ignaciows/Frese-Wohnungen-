/**
 * Reply tracking: outcome flags and the logged conversation per contact.
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

async function seedContacted() {
  const { hashPassword } = await import('@/lib/auth');
  const { syncSeedCatalog } = await import('@/server/sources');
  const { createCandidateCase } = await import('@/server/candidates');
  const { ingestListing } = await import('@/server/listingIngest');
  const { confirmContact } = await import('@/server/contact');

  const passwordHash = await hashPassword('test-pw-1234');
  const user = await prisma.user.create({
    data: { email: 'k@test.local', name: 'Kollegin', role: 'COLLEAGUE', passwordHash },
  });
  await syncSeedCatalog();
  const candidate = await createCandidateCase({
    reference: 'CAND-RESP-01',
    displayName: 'Antwort-Test',
    createdById: user.id,
    workplace: { address: 'Teststr. 1', city: 'Heilbronn', postalCode: '74072' },
  });
  await prisma.applicationMessage.update({
    where: { candidateCaseId: candidate.id },
    data: { body: 'Anschreiben Text', updatedById: user.id },
  });
  const source = await prisma.source.findFirstOrThrow({ where: { key: 'immoscout24' } });
  const listing = await ingestListing({
    sourceId: source.id,
    rawUrl: 'https://www.immobilienscout24.de/expose/7000000001',
    title: 'Testwohnung',
    descriptionRaw: 'Warmmiete 800 €. Möbliert.',
    importedById: user.id,
  });
  const r = await confirmContact({
    candidateCaseId: candidate.id,
    listingId: listing.listingId,
    userId: user.id,
  });
  if (!r.ok) throw new Error('contact should succeed');
  return { user, candidate, attemptId: r.contactAttemptId };
}

describe('contact outcome', () => {
  it('starts as AWAITING', async () => {
    const { attemptId } = await seedContacted();
    const a = await prisma.contactAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(a.outcome).toBe('AWAITING');
    expect(a.outcomeAt).toBeNull();
  });

  it('records POSITIVE with user and timestamp', async () => {
    const { user, attemptId } = await seedContacted();
    await prisma.contactAttempt.update({
      where: { id: attemptId },
      data: { outcome: 'POSITIVE', outcomeAt: new Date(), outcomeById: user.id },
    });
    const a = await prisma.contactAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(a.outcome).toBe('POSITIVE');
    expect(a.outcomeById).toBe(user.id);
    expect(a.outcomeAt).not.toBeNull();
  });

  it('keeps the immutable message snapshot when an outcome is set', async () => {
    const { user, attemptId } = await seedContacted();
    const before = await prisma.contactAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    await prisma.contactAttempt.update({
      where: { id: attemptId },
      data: { outcome: 'NEGATIVE', outcomeAt: new Date(), outcomeById: user.id },
    });
    const after = await prisma.contactAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(after.messageSnapshot).toBe(before.messageSnapshot);
    expect(after.contactedAt.getTime()).toBe(before.contactedAt.getTime());
  });
});

describe('conversation log', () => {
  it('stores incoming and outgoing messages in order', async () => {
    const { user, attemptId } = await seedContacted();
    await prisma.contactMessage.create({
      data: {
        contactAttemptId: attemptId,
        direction: 'INCOMING',
        body: 'Die Wohnung ist noch frei.',
        recordedById: user.id,
        occurredAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.contactMessage.create({
      data: {
        contactAttemptId: attemptId,
        direction: 'OUTGOING',
        body: 'Wann wäre eine Besichtigung möglich?',
        recordedById: user.id,
      },
    });
    const msgs = await prisma.contactMessage.findMany({
      where: { contactAttemptId: attemptId },
      orderBy: { occurredAt: 'asc' },
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].direction).toBe('INCOMING');
    expect(msgs[1].direction).toBe('OUTGOING');
  });

  it('deletes the conversation when the contact is removed', async () => {
    const { user, attemptId } = await seedContacted();
    await prisma.contactMessage.create({
      data: { contactAttemptId: attemptId, direction: 'INCOMING', body: 'Test', recordedById: user.id },
    });
    await prisma.systemTransfer.deleteMany({ where: { contactAttemptId: attemptId } });
    await prisma.contactAttempt.delete({ where: { id: attemptId } });
    const left = await prisma.contactMessage.count({ where: { contactAttemptId: attemptId } });
    expect(left).toBe(0);
  });
});
