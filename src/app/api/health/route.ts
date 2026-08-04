/**
 * Trivial health endpoint for uptime monitors / Railway health checks.
 * Deliberately does NOT touch the database — so a database blip doesn't take
 * the healthcheck down and cause a restart loop.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(JSON.stringify({ ok: true, service: 'frese-wohnung' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
