/**
 * Scheduled discovery sweep. POST + shared secret, the same contract the mail
 * ingest and liveness endpoints already use, so one cron entry can drive all
 * three without a user session.
 *
 * The in-app trigger throttles itself and only fires when somebody opens the
 * app; this is what keeps the pool fresh overnight and at weekends, which is
 * exactly when good flats appear and disappear.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { runDiscoverySweep } from '@/server/discovery';
import { timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
// A full sweep across several sources with polite per-host delays is slow by
// design; anything less than this would cut it off mid-run.
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  const expected = process.env.INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'INGEST_TOKEN ist nicht gesetzt — Endpoint deaktiviert.' },
      { status: 503 },
    );
  }
  const provided = req.headers.get('x-ingest-token') ?? req.nextUrl.searchParams.get('token') ?? '';
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ ok: false, error: 'Nicht autorisiert.' }, { status: 401 });
  }

  const maxRequests = Number(req.nextUrl.searchParams.get('maxRequests') ?? '') || undefined;

  try {
    const summary = await runDiscoverySweep({ force: true, maxRequests });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message.slice(0, 300) }, { status: 500 });
  }
}

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
