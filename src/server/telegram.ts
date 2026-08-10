/**
 * Telegram bridge.
 *
 * Outbound: the team gets a push when something needs a human — a landlord
 * answered, a follow-up is due, new listings arrived. The point is to stop
 * people polling the app all day.
 *
 * Inbound: a colleague can log a note or an answer straight from the chat, so
 * a phone call in the car still ends up in the candidate's history.
 *
 * The bot token lives in the environment only. Every send is best-effort:
 * a Telegram outage must never break a contact flow or fail a request.
 */

import { prisma } from '@/lib/prisma';

const API = 'https://api.telegram.org';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  /** Shared secret Telegram echoes back on every webhook call. */
  webhookSecret: string | null;
}

export function readTelegramConfig(): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;
  return { botToken, chatId, webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? null };
}

export function isTelegramConfigured(): boolean {
  return readTelegramConfig() != null;
}

/** Telegram's MarkdownV2 needs a lot of escaping; plain text is safer. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function send(text: string, options: { silent?: boolean } = {}): Promise<boolean> {
  const cfg = readTelegramConfig();
  if (!cfg) return false;
  try {
    const res = await fetch(`${API}/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: options.silent ?? false,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    // Never let a messaging outage propagate into the workflow.
    return false;
  }
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  return send(text);
}

/* --------------------------------------------------------- notifications */

async function enabled(event: keyof NotificationSettings): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  const { getTelegramSettings } = await import('./settings');
  const s = await getTelegramSettings();
  return s.enabled && s[event] === true;
}

export interface NotificationSettings {
  enabled: boolean;
  onReply: boolean;
  onPositive: boolean;
  onNewListings: boolean;
  onFollowUpDue: boolean;
}

export const DEFAULT_TELEGRAM: NotificationSettings = {
  enabled: true,
  onReply: true,
  onPositive: true,
  onNewListings: false,
  onFollowUpDue: true,
};

export async function notifyReplyReceived(p: {
  candidateReference: string;
  candidateCaseId: string;
  listingTitle: string;
  excerpt: string;
}): Promise<void> {
  if (!(await enabled('onReply'))) return;
  await send(
    `📨 <b>Antwort erhalten</b>\n` +
      `${escapeHtml(p.candidateReference)} · ${escapeHtml(p.listingTitle)}\n\n` +
      `<i>${escapeHtml(p.excerpt)}</i>\n\n` +
      `Verlauf: /kandidat ${escapeHtml(p.candidateReference)}`,
  );
}

export async function notifyPositiveOutcome(p: {
  candidateReference: string;
  listingTitle: string;
}): Promise<void> {
  if (!(await enabled('onPositive'))) return;
  await send(
    `✅ <b>Positive Rückmeldung</b>\n${escapeHtml(p.candidateReference)} · ${escapeHtml(p.listingTitle)}`,
  );
}

export async function notifyNewListings(p: {
  candidateReference: string;
  count: number;
  sourceName: string;
}): Promise<void> {
  if (!(await enabled('onNewListings'))) return;
  await send(
    `🏠 <b>${p.count} neue Anzeige(n)</b>\n${escapeHtml(p.candidateReference)} · ${escapeHtml(p.sourceName)}`,
    { silent: true },
  );
}

/** Daily digest of everything that is due. Called by the cron endpoint. */
export async function sendDailyDigest(): Promise<boolean> {
  if (!(await enabled('onFollowUpDue'))) return false;

  const now = new Date();
  const [dueFollowUps, awaiting, upcoming] = await Promise.all([
    prisma.candidateListingMatch.findMany({
      where: { followUpAt: { lte: now } },
      include: {
        candidateCase: { select: { reference: true } },
        listing: { select: { title: true } },
      },
      take: 15,
    }),
    prisma.contactAttempt.count({ where: { outcome: 'AWAITING' } }),
    prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { gte: now, lte: new Date(now.getTime() + 36 * 3_600_000) },
      },
      include: { candidateCase: { select: { reference: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    }),
  ]);

  if (dueFollowUps.length === 0 && upcoming.length === 0) return false;

  const lines: string[] = ['📋 <b>Heute zu tun</b>'];
  if (dueFollowUps.length > 0) {
    lines.push('', `<b>Wiedervorlage fällig (${dueFollowUps.length})</b>`);
    for (const f of dueFollowUps) {
      lines.push(`• ${escapeHtml(f.candidateCase.reference)} — ${escapeHtml(f.listing.title)}`);
    }
  }
  if (upcoming.length > 0) {
    lines.push('', `<b>Termine in den nächsten 36 h</b>`);
    for (const a of upcoming) {
      lines.push(
        `• ${a.scheduledAt.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — ${escapeHtml(a.candidateCase.reference)}`,
      );
    }
  }
  lines.push('', `${awaiting} Anfrage(n) warten noch auf Antwort.`);

  return send(lines.join('\n'));
}

/* ------------------------------------------------------- inbound webhook */

export interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
    from?: { first_name?: string; username?: string };
  };
}

/**
 * Handles a webhook update. Supported commands are deliberately few — this is
 * a bridge, not a second UI.
 *
 *   /status            → what is open right now
 *   /notiz REF text    → append a note to that candidate's newest conversation
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<string | null> {
  const cfg = readTelegramConfig();
  if (!cfg) return null;

  const text = update.message?.text?.trim();
  const chatId = String(update.message?.chat?.id ?? '');
  // Only the configured chat may drive the bot.
  if (!text || chatId !== String(cfg.chatId)) return null;

  if (text.startsWith('/start') || text.startsWith('/hilfe') || text.startsWith('/help')) {
    return (
      'Frese Wohnung — Bot\n\n' +
      '/status — offene Anfragen, fällige Wiedervorlagen, nächste Termine\n' +
      '/notiz REF Text — Notiz an das jüngste Gespräch des Kandidaten anhängen'
    );
  }

  if (text.startsWith('/status')) {
    const [awaiting, due, cases] = await Promise.all([
      prisma.contactAttempt.count({ where: { outcome: 'AWAITING' } }),
      prisma.candidateListingMatch.count({ where: { followUpAt: { lte: new Date() } } }),
      prisma.candidateCase.count({ where: { status: 'ACTIVE' } }),
    ]);
    return `${cases} aktive Kandidaten\n${awaiting} Anfragen ohne Antwort\n${due} fällige Wiedervorlagen`;
  }

  if (text.startsWith('/notiz')) {
    const m = text.match(/^\/notiz\s+(\S+)\s+([\s\S]+)$/);
    if (!m) return 'Format: /notiz REF Text — z. B. /notiz CAND-2026-014 Vermieter ruft morgen an';
    const [, ref, note] = m;

    const attempt = await prisma.contactAttempt.findFirst({
      where: { candidateCase: { reference: ref.toUpperCase() } },
      orderBy: { contactedAt: 'desc' },
      include: { listing: { select: { title: true } } },
    });
    if (!attempt) return `Kein Gespräch für ${ref} gefunden.`;

    const author = await prisma.user.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!author) return 'Kein aktiver Benutzer — Notiz nicht gespeichert.';

    await prisma.contactMessage.create({
      data: {
        contactAttemptId: attempt.id,
        direction: 'INCOMING',
        // Marked as coming from Telegram so nobody mistakes it for a portal
        // message the landlord actually sent.
        body: `[via Telegram] ${note}`,
        recordedById: author.id,
      },
    });
    return `Notiz gespeichert bei „${attempt.listing.title}".`;
  }

  return null;
}
