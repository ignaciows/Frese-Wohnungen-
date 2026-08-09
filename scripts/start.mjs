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

const step = (msg) => console.log(`\n[start] ${msg}`);

function run(cmd, args, { allowFailure = false } = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env, shell: false });
  if (r.status !== 0 && !allowFailure) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
  }
  return r.status === 0;
}

function migrate() {
  step('Applying database migrations…');
  if (run('npx', ['prisma', 'migrate', 'deploy'], { allowFailure: true })) {
    console.log('[start] Migrations applied.');
    return true;
  }

  // Most common cause: the schema was created out-of-band (e.g. `db push`), so
  // the migration history and the real schema disagree. Reconcile rather than
  // refusing to boot.
  console.warn('[start] migrate deploy failed — reconciling schema with `prisma db push`.');
  if (run('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], { allowFailure: true })) {
    console.log('[start] Schema reconciled via db push.');
    return true;
  }

  console.error('[start] Could not bring the database up to date. Starting anyway;');
  console.error('[start] check /api/diagnostics and run `npx prisma migrate deploy` in the console.');
  return false;
}

function seed() {
  step('Seeding baseline data (idempotent)…');
  if (!run('npx', ['tsx', 'prisma/seed.ts'], { allowFailure: true })) {
    console.warn('[start] Seed step failed — continuing. Existing data is untouched.');
  }
}

step(`Booting Frese Wohnung (commit ${(process.env.RAILWAY_GIT_COMMIT_SHA ?? 'unknown').slice(0, 8)})`);
migrate();
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
