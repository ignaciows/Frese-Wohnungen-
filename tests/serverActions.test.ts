import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The rule that cost two deployments.
 *
 * A file marked `'use server'` may only export async functions — every export
 * becomes a callable endpoint, and Next.js has nothing to do with a plain
 * constant. Export one anyway and the app still typechecks, still lints, and
 * still passes every other test; it fails at `next build`, which in practice
 * means it fails on the deployment server, minutes later, in a log nobody is
 * watching.
 *
 * Twice the offender was the same shape: a shared array of source keys parked
 * next to the actions that used it. Both times the fix was to move the
 * constant into `src/domain`. This test is here so the third time takes a
 * second rather than a deployment.
 *
 * It reads the files rather than importing them: importing a 'use server'
 * module outside Next's build gives back a proxy, and the point is to check
 * what is written down.
 */

const ROOT = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** Files whose first meaningful line is the 'use server' directive. */
function serverActionFiles(): Array<{ path: string; text: string }> {
  return sourceFiles(ROOT)
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
    .filter(({ text }) => /^\s*['"]use server['"]\s*;/.test(text));
}

/** Every top-level `export …` in the file, as the word that follows it. */
function exportKinds(text: string): Array<{ line: number; statement: string }> {
  const out: Array<{ line: number; statement: string }> = [];
  text.split('\n').forEach((raw, i) => {
    // Top-level only: an export nested in a block is indented.
    if (!raw.startsWith('export')) return;
    out.push({ line: i + 1, statement: raw.trim() });
  });
  return out;
}

describe("'use server' files", () => {
  it('exist at all, or this test is guarding nothing', () => {
    expect(serverActionFiles().length).toBeGreaterThan(0);
  });

  it('export nothing but async functions', () => {
    const offences: string[] = [];
    for (const { path, text } of serverActionFiles()) {
      for (const { line, statement } of exportKinds(text)) {
        const ok =
          statement.startsWith('export async function') ||
          // A type never reaches the runtime, so it cannot become an endpoint.
          statement.startsWith('export type ') ||
          statement.startsWith('export interface ');
        if (!ok) {
          offences.push(`${path.replace(process.cwd() + '/', '')}:${line} — ${statement}`);
        }
      }
    }
    expect(
      offences,
      'A "use server" file can only export async functions. Move constants into src/domain and types beside them.',
    ).toEqual([]);
  });
});
