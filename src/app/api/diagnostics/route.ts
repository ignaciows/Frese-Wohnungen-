/**
 * Public-safe diagnostics for deployment troubleshooting.
 * Reports what's configured and reachable WITHOUT ever leaking a secret value.
 * Only ever emits presence / length / status, never the value itself.
 */

import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface Report {
  ok: boolean;
  deployment: Record<string, string>;
  checks: Record<string, { ok: boolean; detail: string }>;
}

/** Features whose presence proves which commit is actually serving traffic. */
const FEATURE_MARKERS = [
  { since: 'redesign', label: 'Kandidaten-Navigation & WG-Vorschläge' },
  { since: 'priority', label: 'Kandidaten-Priorität' },
  { since: 'sharing', label: 'Termine & Einstellungen' },
  { since: 'mail', label: 'Suchagent-Postfach' },
  { since: 'freshness', label: 'Aktualität & Überbrückungskosten' },
];

export async function GET() {
  const report: Report = { ok: true, deployment: {}, checks: {} };

  // Railway injects these; other platforms may not. Never fail on absence.
  report.deployment.commit = (process.env.RAILWAY_GIT_COMMIT_SHA ?? 'unbekannt').slice(0, 8);
  report.deployment.branch = process.env.RAILWAY_GIT_BRANCH ?? 'unbekannt';
  report.deployment.deployedAt = process.env.RAILWAY_DEPLOYMENT_ID
    ? `deployment ${process.env.RAILWAY_DEPLOYMENT_ID.slice(0, 8)}`
    : 'unbekannt';
  report.deployment.features = FEATURE_MARKERS.map((f) => f.label).join(' · ');
  report.deployment.startedAt = START_TIME;

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
    detail:
      dbUrl.length === 0
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

  report.checks.MAIL_INGEST = {
    ok: true,
    detail: process.env.MAIL_IMAP_HOST
      ? 'Postfach konfiguriert'
      : 'Nicht konfiguriert (optional) — siehe docs/EMAIL_INGEST.md',
  };

  try {
    const [userCount, sourceCount, candidateCount] = await Promise.all([
      prisma.user.count(),
      prisma.source.count(),
      prisma.candidateCase.count(),
    ]);
    report.checks.database = {
      ok: true,
      detail: `Reachable. users=${userCount}, sources=${sourceCount}, candidates=${candidateCount}`,
    };
    report.checks.seed = userCount === 0
      ? {
          ok: false,
          detail: 'No users — seed did not run. Start command must include the seed step.',
        }
      : { ok: true, detail: 'Users present.' };

    // Does the live database actually have the newest schema? This is the
    // question that "did my deploy work" really comes down to.
    const applied = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      ORDER BY started_at DESC
      LIMIT 1
    `;
    const failed = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NULL
    `;
    const failedCount = Number(failed[0]?.n ?? 0);
    report.checks.migrations = {
      ok: failedCount === 0,
      detail:
        failedCount > 0
          ? `${failedCount} Migration(en) unvollständig — in der Railway-Console "npx prisma migrate deploy" ausführen.`
          : `Neueste angewendete Migration: ${applied[0]?.migration_name ?? 'keine'}`,
    };

    // Column that only exists from the freshness release onwards.
    try {
      await prisma.$queryRaw`SELECT "lastSeenAt" FROM "Listing" LIMIT 1`;
      report.checks.schemaUpToDate = { ok: true, detail: 'Schema enthält die neuesten Felder.' };
    } catch {
      report.checks.schemaUpToDate = {
        ok: false,
        detail:
          'Schema ist älter als der Code — Migrationen wurden nicht angewendet. In der Console: npx prisma migrate deploy',
      };
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
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Set once per process, so a changing value proves the container restarted. */
const START_TIME = new Date().toISOString();
