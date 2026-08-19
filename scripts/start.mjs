/**
 * Production startup.
 *
 * The naive `migrate && seed && start` chain has a nasty failure mode: if the
 * migration step exits non-zero the container never boots, the platform keeps
 * the previous deployment alive, and it looks like "my deploy did nothing".
 *
 * So: try the correct thing first, fall back to reconciling the schema, and
 * always start the server — printing loudly what happened. A running app with
 * a clear error in /api/diagnostics beats a silent rollback.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const step = (msg) => console.log(`\n[start] ${msg}`);

function run(cmd, args, { allowFailure = false } = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env, shell: false });
  if (r.status !== 0 && !allowFailure) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
  }
  return r.status === 0;
}

/**
 * Which migrations are stuck, asked of the database rather than of a CLI.
 *
 * The first version of this parsed `prisma migrate status`, and it worked
 * locally and did nothing in production — the same Prisma version, a different
 * enough shape of output. Scraping a CLI for a decision this consequential was
 * the mistake; `_prisma_migrations` is a plain table and answers exactly.
 *
 * Stuck means: started, never finished, and never rolled back. A row with
 * `rolled_back_at` set is the *record* of a failed attempt that has since been
 * resolved — history, not a problem.
 */
async function failedMigrations() {
  let client;
  try {
    const { PrismaClient } = await import('@prisma/client');
    client = new PrismaClient();
    const rows = await client.$queryRawUnsafe(
      'SELECT migration_name FROM "_prisma_migrations"' +
        ' WHERE finished_at IS NULL AND rolled_back_at IS NULL' +
        ' ORDER BY started_at',
    );
    return rows.map((r) => r.migration_name);
  } catch (err) {
    // No table yet (first ever deploy), or no database. Either way there is
    // nothing stuck to clean up — but say so, because a silent [] here is
    // indistinguishable from "everything is fine" and that is exactly how the
    // first version of this went unnoticed in production.
    console.warn(`[start] Could not read migration history: ${err?.message ?? err}`);
    return [];
  } finally {
    await client?.$disconnect().catch(() => {});
  }
}

async function migrate() {
  step('Applying database migrations…');
  if (run('npx', ['prisma', 'migrate', 'deploy'], { allowFailure: true })) {
    console.log('[start] Migrations applied.');
    return true;
  }

  // A migration that died mid-way. Every migration in this repo is written to
  // be re-runnable (IF EXISTS / IF NOT EXISTS throughout), so the honest
  // recovery is to mark it rolled back and let it run again — rather than
  // papering over it with `db push` and leaving the history broken forever.
  const failed = await failedMigrations();
  if (failed.length > 0) {
    console.warn(`[start] Failed migration(s) on record: ${failed.join(', ')}`);
    for (const name of failed) {
      run('npx', ['prisma', 'migrate', 'resolve', '--rolled-back', name], { allowFailure: true });
    }
    if (run('npx', ['prisma', 'migrate', 'deploy'], { allowFailure: true })) {
      console.log('[start] Migrations applied after resolving the failed one(s).');
      return true;
    }
  }

  // Last resort: the schema was created out-of-band and the history cannot be
  // reconciled. Keep the app usable, and say so loudly — /api/diagnostics
  // reports the mismatch so it does not stay invisible.
  //
  // Erst aber jede Migration von Hand durchlaufen lassen. `db push` vergleicht
  // nur Schema und Datenbank und kennt kein Umbenennen: eine Spalte, die
  // anders heißt, wird gelöscht und neu angelegt — mitsamt allem, was drin
  // stand. Die Dateien hier sind alle wiederholbar geschrieben (IF EXISTS /
  // IF NOT EXISTS), also kostet ein zweiter Durchlauf nichts und rettet im
  // Zweifel genau das.
  applyMigrationsByHand();

  console.warn('[start] migrate deploy still failing — reconciling schema with `prisma db push`.');
  if (run('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], { allowFailure: true })) {
    console.warn('[start] Schema reconciled via db push. Migration history is NOT up to date.');
    return true;
  }

  console.error('[start] Could not bring the database up to date. Starting anyway;');
  console.error('[start] check /api/diagnostics and run `npx prisma migrate deploy` in the console.');
  return false;
}

/**
 * Jede Migrationsdatei einmal einspielen, ohne Buchführung.
 *
 * Nur für den Notfallpfad oben. Fehler sind erwartet — was schon angewandt
 * ist, meldet sich als „existiert bereits" — deshalb bricht hier nichts ab.
 */
function applyMigrationsByHand() {
  const dir = new URL('../prisma/migrations/', import.meta.url);
  let names;
  try {
    names = readdirSync(dir).filter((n) => !n.endsWith('.toml')).sort();
  } catch {
    return;
  }
  step(`Replaying ${names.length} migration file(s) directly…`);
  for (const name of names) {
    run('npx', ['prisma', 'db', 'execute', '--file', `prisma/migrations/${name}/migration.sql`,
      '--schema', 'prisma/schema.prisma'], { allowFailure: true });
  }
}

function seed() {
  step('Seeding baseline data (idempotent)…');
  if (!run('npx', ['tsx', 'prisma/seed.ts'], { allowFailure: true })) {
    console.warn('[start] Seed step failed — continuing. Existing data is untouched.');
  }
}

step(`Booting Frese Wohnung (commit ${(process.env.RAILWAY_GIT_COMMIT_SHA ?? 'unknown').slice(0, 8)})`);
await migrate();
seed();

step('Starting Next.js…');
const port = process.env.PORT ?? '3000';
const server = spawn('npx', ['next', 'start', '-p', port], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

// Forward shutdown signals so the platform can stop the container cleanly.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.kill(sig));
}
server.on('exit', (code) => process.exit(code ?? 0));
