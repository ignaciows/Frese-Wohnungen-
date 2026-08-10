/** Daily Telegram digest. POST + shared secret, same contract as the other jobs. */

import { NextResponse, type NextRequest } from 'next/server';
import { sendDailyDigest } from '@/server/telegram';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'INGEST_TOKEN fehlt.' }, { status: 503 });
  }
  const provided = req.headers.get('x-ingest-token') ?? req.nextUrl.searchParams.get('token') ?? '';
  if (provided.length !== expected.length || provided !== expected) {
    return NextResponse.json({ ok: false, error: 'Nicht autorisiert.' }, { status: 401 });
  }
  const sent = await sendDailyDigest();
  return NextResponse.json({ ok: true, sent });
}
