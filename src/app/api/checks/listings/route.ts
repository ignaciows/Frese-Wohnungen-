/**
 * Scheduled liveness sweep. POST + shared secret, same contract as the mail
 * ingest endpoint, so a cron can call it without a user session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { runLivenessChecks } from '@/server/liveness';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'INGEST_TOKEN ist nicht gesetzt — Endpoint deaktiviert.' },
      { status: 503 },
    );
  }
  const provided = req.headers.get('x-ingest-token') ?? req.nextUrl.searchParams.get('token') ?? '';
  if (provided.length !== expected.length || provided !== expected) {
    return NextResponse.json({ ok: false, error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const summary = await runLivenessChecks();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message.slice(0, 300) }, { status: 500 });
  }
}
