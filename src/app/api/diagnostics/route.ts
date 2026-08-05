/**
 * Public-safe diagnostics for deployment troubleshooting.
 * Reports what's configured and reachable WITHOUT ever leaking a secret value.
 * Only ever emits presence / length / status, never the value itself.
 */

import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface Report {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail: string }>;
}

export async function GET() {
  const report: Report = { ok: true, checks: {} };

  const secret = process.env.SESSION_SECRET ?? '';
  report.checks.SESSION_SECRET = {
    ok: secret.length >= 32,
    detail:
      secret.length === 0
        ? 'MISSING — set SESSION_SECRET in Railway → Variables to at least 32 characters'
        : secret.length < 32
        ? `TOO SHORT (${secret.length} chars, need ≥32) — regenerate and update SESSION_SECRET`
        : `OK (${secret.length} chars)`,
  };

  const dbUrl = process.env.DATABASE_URL ?? '';
  report.checks.DATABASE_URL = {
    ok: dbUrl.length > 0,
    detail: dbUrl.length === 0
      ? 'MISSING — attach the Postgres service or reference DATABASE_URL from it'
      : `OK (${dbUrl.length} chars, starts with "${dbUrl.slice(0, 12)}…")`,
  };

  const cookieName = process.env.SESSION_COOKIE_NAME ?? '';
  report.checks.SESSION_COOKIE_NAME = {
    ok: cookieName.length > 0,
    detail: cookieName.length > 0 ? `OK ("${cookieName}")` : 'Using default "frese_wohnung_session"',
  };

  report.checks.SESSION_SECURE_COOKIE = {
    ok: true,
    detail: `= "${process.env.SESSION_SECURE_COOKIE ?? '(unset, defaults to false)'}"`,
  };

  // Try to open a DB connection and count users.
  try {
    const userCount = await prisma.user.count();
    const sourceCount = await prisma.source.count();
    const candidateCount = await prisma.candidateCase.count();
    report.checks.database = {
      ok: true,
      detail: `Reachable. users=${userCount}, sources=${sourceCount}, candidates=${candidateCount}`,
    };
    if (userCount === 0) {
      report.checks.seed = {
        ok: false,
        detail: 'No users — seed did not run. Custom Start Command must include `npm run db:seed` (or use `npm run release`).',
      };
    } else {
      report.checks.seed = { ok: true, detail: 'Users present.' };
    }
  } catch (err) {
    report.checks.database = {
      ok: false,
      detail: `UNREACHABLE — ${(err as Error).message.slice(0, 200)}`,
    };
  }

  report.ok = Object.values(report.checks).every((c) => c.ok);

  return new Response(JSON.stringify(report, null, 2), {
    status: report.ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
}
