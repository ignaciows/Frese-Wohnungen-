/**
 * Every Anfrage earns a reminder, whoever sent it.
 *
 * The reminder was only ever scheduled on the path where the app posts the
 * e-mail itself — and the app is not allowed to until a sending address is
 * configured, which on the live install it never was. So in practice no
 * enquiry produced a task at all: a colleague wrote to a landlord, marked it
 * contacted, and had nothing anywhere telling them to look for an answer.
 * Remembering that by hand, across three candidates and thirty enquiries, is
 * exactly the job this tool exists to take away.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureMigrated, truncateAll } from './setup';
import { scheduleReplyCheck } from '@/server/followUps';

let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  ensureMigrated();
  ({ prisma } = await import('@/lib/prisma'));
});

beforeEach(async () => {
  await truncateAll();
});

/** A contact attempt made by hand, the way it happens today. */
async function seedContactAttempt(contactedAt = new Date()) {
  const { hashPassword } = await import('@/lib/auth');
  const user = await prisma.user.create({
    data: {
      email: 'reminder@test.local',
      name: 'Test',
      role: 'ADMIN',
      passwordHash: await hashPassword('test-pw-1234'),
    },
  });
  const candidate = await prisma.candidateCase.create({
    data: { reference: 'CAND-RR-01', displayName: 'Test', createdById: user.id },
  });
  const source = await prisma.source.create({
    data: {
      key: 'reminder-source',
      name: 'Testquelle',
      websiteUrl: 'https://example.de',
      category: 'MARKETPLACE',
      integrationMode: 'SEARCH_LINK',
    },
  });
  const listing = await prisma.listing.create({
    data: {
      sourceId: source.id,
      importedById: user.id,
      canonicalUrl: 'https://example.de/ad-1',
      rawUrl: 'https://example.de/ad-1',
      title: '2-Zimmer-Wohnung in Heilbronn',
      origin: 'DISCOVERY',
      expired: false,
    },
  });
  const attempt = await prisma.contactAttempt.create({
    data: {
      listingId: listing.id,
      candidateCaseId: candidate.id,
      userId: user.id,
      messageSnapshot: 'Sehr geehrte Damen und Herren …',
      contactedAt,
    },
  });
  return { attempt, candidate, listing };
}

describe('the reminder that follows an Anfrage', () => {
  it('is created, and falls due three days later', async () => {
    const contactedAt = new Date('2026-08-10T09:00:00Z');
    const { attempt, candidate, listing } = await seedContactAttempt(contactedAt);

    await scheduleReplyCheck(attempt.id);

    const task = await prisma.followUpTask.findFirstOrThrow({
      where: { contactAttemptId: attempt.id },
    });
    expect(task.kind).toBe('CHECK_REPLY');
    expect(task.state).toBe('OPEN');
    expect(task.candidateCaseId).toBe(candidate.id);
    expect(task.listingId).toBe(listing.id);
    // Three days after the contact, not three days after the sweep noticed.
    const days = (task.dueAt.getTime() - contactedAt.getTime()) / 86_400_000;
    expect(days).toBe(3);
  });

  it('names the flat, so the task is actionable without opening it', async () => {
    const { attempt } = await seedContactAttempt();

    await scheduleReplyCheck(attempt.id);

    const task = await prisma.followUpTask.findFirstOrThrow({
      where: { contactAttemptId: attempt.id },
    });
    expect(task.title).toContain('2-Zimmer-Wohnung in Heilbronn');
  });

  it('never produces a second reminder for the same conversation', async () => {
    // Contacting again after an override, or a retried send, must not leave two
    // identical reminders for one landlord.
    const { attempt } = await seedContactAttempt();

    await scheduleReplyCheck(attempt.id);
    await scheduleReplyCheck(attempt.id);

    expect(await prisma.followUpTask.count({ where: { contactAttemptId: attempt.id } })).toBe(1);
  });

  it('shows up as due once the three days have passed', async () => {
    const { listDueTasks } = await import('@/server/followUps');
    const { attempt, candidate } = await seedContactAttempt(
      new Date(Date.now() - 5 * 86_400_000),
    );

    await scheduleReplyCheck(attempt.id);
    const due = await listDueTasks({ candidateCaseId: candidate.id });

    expect(due.length).toBe(1);
  });

  it('stays quiet while the landlord still has time to answer', async () => {
    // A reminder that fires the same afternoon is one people learn to ignore.
    const { listDueTasks } = await import('@/server/followUps');
    const { attempt, candidate } = await seedContactAttempt(new Date());

    await scheduleReplyCheck(attempt.id);

    expect((await listDueTasks({ candidateCaseId: candidate.id })).length).toBe(0);
  });
});
