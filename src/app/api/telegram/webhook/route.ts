/**
 * Telegram webhook. Verified with the secret token Telegram echoes in a header,
 * so nobody else can drive the bot. Always answers 200 — a non-200 makes
 * Telegram retry the same update forever.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { handleTelegramUpdate, readTelegramConfig, sendTelegramMessage } from '@/server/telegram';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cfg = readTelegramConfig();
  if (!cfg) return NextResponse.json({ ok: true, skipped: 'not configured' });

  if (cfg.webhookSecret) {
    const provided = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (provided !== cfg.webhookSecret) {
      return NextResponse.json({ ok: true, skipped: 'bad secret' });
    }
  }

  try {
    const update = await req.json();
    const reply = await handleTelegramUpdate(update);
    if (reply) await sendTelegramMessage(reply);
  } catch {
    // Swallow: retrying a malformed update helps nobody.
  }
  return NextResponse.json({ ok: true });
}
