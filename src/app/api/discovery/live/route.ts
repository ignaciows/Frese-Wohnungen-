/**
 * The search, watched while it happens.
 *
 * The scheduled endpoint next door answers once, at the end, which is right for
 * a cron job and wrong for a person: a sweep takes one to three minutes, and a
 * screen that says nothing for that long looks broken — a colleague showing the
 * tool to their boss sat in front of a blank list for two minutes. This route
 * runs the same sweep and writes every event out as it occurs, one JSON object
 * per line, so the flats appear on screen one by one as they are found.
 *
 * NDJSON rather than Server-Sent Events: the client reads it with `fetch`, so a
 * POST (which no link prefetch can ever trigger) is enough, and there is no
 * reconnect logic to get wrong for a stream that is meant to end.
 */

import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { runDiscoverySweep, sweepSkipReason, type SweepEvent } from '@/server/discovery';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
// The same ceiling the cron sweep uses: a full pass with polite per-host delays
// is slow by design, and cutting it off mid-run loses the sources at the back.
export const maxDuration = 800;

type StreamLine =
  | SweepEvent
  | { type: 'start'; force: boolean; lastRunAt: string | null; enabledSources: number }
  | { type: 'skipped'; reason: string; lastRunAt: string | null; enabledSources: number }
  | { type: 'ping' }
  | { type: 'error'; message: string };

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return Response.json({ ok: false, error: 'Nicht angemeldet.' }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get('force') === '1';
  const [lastRun, enabledSources] = await Promise.all([
    prisma.discoveryRun.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    prisma.source.count({ where: { discoveryEnabled: true } }),
  ]);
  const lastRunAt = lastRun?.startedAt.toISOString() ?? null;

  // Opening a stream only to close it again is a progress bar that flickers for
  // nothing, so the throttle is asked before a single byte is written.
  if (!force) {
    const skip = await sweepSkipReason();
    if (skip) {
      return ndjson([{ type: 'skipped', reason: skip, lastRunAt, enabledSources }]);
    }
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: StreamLine) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
        } catch {
          // The reader went away — the sweep still finishes and still writes
          // everything it found to the database.
          closed = true;
        }
      };

      send({ type: 'start', force, lastRunAt, enabledSources });
      // Proxies drop a connection that goes quiet, and a source with a slow
      // first page can take half a minute before it has anything to say.
      const heartbeat = setInterval(() => send({ type: 'ping' }), 15_000);

      try {
        await runDiscoverySweep({ force, onEvent: send });
      } catch (err) {
        send({ type: 'error', message: (err as Error).message.slice(0, 300) });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, { headers: streamHeaders() });
}

function ndjson(lines: StreamLine[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l) + '\n').join(''), {
    headers: streamHeaders(),
  });
}

function streamHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    // Nginx buffers a response body by default, which would hold every event
    // back until the sweep finished — exactly the wait this route removes.
    'X-Accel-Buffering': 'no',
  };
}
