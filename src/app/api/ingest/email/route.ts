/**
 * Trigger for the scheduled mailbox import.
 *
 * POST only, and protected by a shared secret so a scheduler can call it
 * without a user session. If INGEST_TOKEN is unset the endpoint refuses to run
 * rather than defaulting to open.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { ingestMailbox } from '@/server/mailIngest';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'INGEST_TOKEN ist nicht gesetzt — Endpoint deaktiviert.' },
      { status: 503 },
    );
  }

  const provided =
    req.headers.get('x-ingest-token') ?? req.nextUrl.searchParams.get('token') ?? '';
  // Length check first so a mismatch cannot be probed by timing alone.
  if (provided.length !== expected.length || provided !== expected) {
    return NextResponse.json({ ok: false, error: 'Nicht autorisiert.' }, { status: 401 });
  }

  try {
    const summary = await ingestMailbox();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message.slice(0, 300) },
      { status: 500 },
    );
  }
}
