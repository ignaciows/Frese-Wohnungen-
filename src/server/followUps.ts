/**
 * The to-do list and the notification bell.
 *
 * The rule that shapes this module: a message going out must create its own
 * reminder. "Check whether they answered" is exactly the kind of task that
 * quietly never happens, and an Anfrage nobody follows up on is a wasted one.
 */

import { prisma } from '@/lib/prisma';
import { getFollowUpSettings } from './settings';

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/**
 * Schedules "did anyone answer?" for a contact attempt.
 *
 * Idempotent through the unique index on (contactAttemptId, kind): running the
 * job twice, or contacting again after an override, never produces two open
 * reminders for the same conversation.
 */
export async function scheduleReplyCheck(
  contactAttemptId: string,
  options: { days?: number; note?: string } = {},
): Promise<void> {
  const settings = await getFollowUpSettings();
  if (!settings.autoCreate && options.days == null) return;

  const attempt = await prisma.contactAttempt.findUnique({
    where: { id: contactAttemptId },
    select: {
      id: true,
      candidateCaseId: true,
      listingId: true,
      contactedAt: true,
      listing: { select: { title: true } },
    },
  });
  if (!attempt) return;

  const days = options.days ?? settings.checkReplyAfterDays;
  const dueAt = addDays(attempt.contactedAt, days);

  await prisma.followUpTask.upsert({
    where: { contactAttemptId_kind: { contactAttemptId, kind: 'CHECK_REPLY' } },
    create: {
      candidateCaseId: attempt.candidateCaseId,
      listingId: attempt.listingId,
      contactAttemptId,
      kind: 'CHECK_REPLY',
      title: `Antwort prüfen: ${attempt.listing.title}`,
      note: options.note ?? null,
      dueAt,
    },
    // Only move an existing reminder further out — never pull it forward and
    // never reopen one a colleague has already dealt with.
    update: {},
  });
}

/** A landlord answered, so the reminder has served its purpose. */
export async function closeReplyCheck(contactAttemptId: string): Promise<void> {
  await prisma.followUpTask.updateMany({
    where: { contactAttemptId, kind: 'CHECK_REPLY', state: 'OPEN' },
    data: { state: 'DONE', completedAt: new Date() },
  });
}

export interface TaskView {
  id: string;
  kind: string;
  title: string;
  note: string | null;
  dueAt: Date;
  overdueDays: number;
  candidateCaseId: string;
  candidateName: string;
  listingId: string | null;
  listingUrl: string | null;
  contactAttemptId: string | null;
  contactedAt: Date | null;
  awaitingSince: number | null;
}

/**
 * Everything due now, most overdue first. A task dated tomorrow is deliberately
 * not shown: the list has to be short enough that people actually work it.
 */
export async function listDueTasks(options: { candidateCaseId?: string; includeFuture?: boolean } = {}): Promise<
  TaskView[]
> {
  const now = new Date();
  const rows = await prisma.followUpTask.findMany({
    where: {
      state: 'OPEN',
      ...(options.candidateCaseId ? { candidateCaseId: options.candidateCaseId } : {}),
      ...(options.includeFuture ? {} : { dueAt: { lte: now } }),
    },
    orderBy: { dueAt: 'asc' },
    take: 200,
    include: {
      candidateCase: { select: { displayName: true, reference: true } },
      listing: { select: { canonicalUrl: true } },
      contactAttempt: { select: { contactedAt: true, outcome: true } },
    },
  });

  return rows.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    note: t.note,
    dueAt: t.dueAt,
    overdueDays: Math.max(0, Math.floor((now.getTime() - t.dueAt.getTime()) / 86_400_000)),
    candidateCaseId: t.candidateCaseId,
    candidateName: t.candidateCase.displayName,
    listingId: t.listingId,
    listingUrl: t.listing?.canonicalUrl ?? null,
    contactAttemptId: t.contactAttemptId,
    contactedAt: t.contactAttempt?.contactedAt ?? null,
    awaitingSince: t.contactAttempt
      ? Math.floor((now.getTime() - t.contactAttempt.contactedAt.getTime()) / 86_400_000)
      : null,
  }));
}

export async function completeTask(
  id: string,
  userId: string,
  state: 'DONE' | 'DISMISSED' = 'DONE',
): Promise<void> {
  const task = await prisma.followUpTask.update({
    where: { id },
    data: { state, completedAt: new Date(), completedById: userId },
  });

  // A first nudge that produced nothing earns exactly one more, then stops.
  if (state === 'DONE' && task.kind === 'CHECK_REPLY' && task.contactAttemptId) {
    const settings = await getFollowUpSettings();
    const attempt = await prisma.contactAttempt.findUnique({
      where: { id: task.contactAttemptId },
      select: { outcome: true },
    });
    if (attempt?.outcome === 'AWAITING' && settings.secondCheckAfterDays > 0) {
      const already = await prisma.followUpTask.count({
        where: { contactAttemptId: task.contactAttemptId, kind: 'CHECK_REPLY' },
      });
      if (already < 2) {
        await prisma.followUpTask.create({
          data: {
            candidateCaseId: task.candidateCaseId,
            listingId: task.listingId,
            // The unique index allows only one row per (attempt, kind), so the
            // second nudge is deliberately not linked back to the attempt.
            kind: 'CUSTOM',
            title: `Zweite Nachfrage: ${task.title.replace(/^Antwort prüfen: /, '')}`,
            note: 'Erste Nachfrage blieb ohne Antwort.',
            dueAt: addDays(new Date(), settings.secondCheckAfterDays),
          },
        });
      }
    }
  }
}

/* ------------------------------------------------------ notifications --- */

export async function notify(input: {
  kind: string;
  title: string;
  body?: string | null;
  url?: string | null;
  candidateCaseId?: string | null;
  listingId?: string | null;
  contactAttemptId?: string | null;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      kind: input.kind,
      title: input.title.slice(0, 300),
      body: input.body?.slice(0, 2000) ?? null,
      url: input.url ?? null,
      candidateCaseId: input.candidateCaseId ?? null,
      listingId: input.listingId ?? null,
      contactAttemptId: input.contactAttemptId ?? null,
    },
  });
}

export async function listNotifications(limit = 30) {
  return prisma.notification.findMany({
    orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    take: limit,
  });
}

export function unreadNotificationCount(): Promise<number> {
  return prisma.notification.count({ where: { readAt: null } });
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  await prisma.notification.updateMany({
    where: { readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}

/** Badge counts for the header: what needs a human right now. */
export async function inboxCounts(): Promise<{ dueTasks: number; unreadReplies: number; notifications: number }> {
  const now = new Date();
  const [dueTasks, unreadReplies, notifications] = await Promise.all([
    prisma.followUpTask.count({ where: { state: 'OPEN', dueAt: { lte: now } } }),
    prisma.contactMessage.count({ where: { direction: 'INCOMING', readAt: null } }),
    prisma.notification.count({ where: { readAt: null } }),
  ]);
  return { dueTasks, unreadReplies, notifications };
}
