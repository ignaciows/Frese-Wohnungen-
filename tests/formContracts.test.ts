/**
 * Every field a server action insists on must exist on the form that posts to
 * it.
 *
 * This is not hypothetical. Rearranging the Suchprofil page swallowed the
 * "Maximale Warmmiete" input while `ProfileInput` still required it, so zod
 * threw on parse and saving the profile answered with a bare
 * "Application error: a server-side exception has occurred" and a digest.
 * Nothing on screen said which field was missing, and nothing in the type
 * system objected: the form is JSX and the schema is zod, and they only meet
 * at runtime.
 *
 * So they are compared here, by reading the page source for `name="…"` and the
 * schema for the keys it will not default. Crude on purpose — it needs no
 * rendering, no database and no browser, and it fails on the commit that breaks
 * the contract rather than in front of somebody trying to save.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

/** Field names the form posts, including hidden inputs. */
function postedFields(...relativePaths: string[]): Set<string> {
  const names = new Set<string>();
  for (const rel of relativePaths) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/name=["']([A-Za-z][\w.]*)["']/g)) names.add(m[1]);
  }
  return names;
}

/**
 * Keys a zod object literal will reject when absent — everything without
 * `.optional()`, `.nullable()` or `.default()` on its line.
 */
function requiredKeys(source: string, schemaName: string): string[] {
  const start = source.indexOf(`const ${schemaName} = z.object({`);
  if (start < 0) throw new Error(`${schemaName} not found`);
  const body = source.slice(start, source.indexOf('\n});', start));

  const keys: string[] = [];
  for (const line of body.split('\n').slice(1)) {
    const m = /^\s{2}(\w+):\s*(.+?),?\s*$/.exec(line);
    if (!m) continue;
    const [, key, decl] = m;
    if (/optional\(|nullable\(|default\(/.test(decl)) continue;
    keys.push(key);
  }
  return keys;
}

const actions = readFileSync(join(ROOT, 'src/app/actions.ts'), 'utf8');

describe('forms carry what their action demands', () => {
  it('Suchprofil posts every field ProfileInput requires', () => {
    const posted = postedFields(
      'src/app/kandidat/[id]/profil/page.tsx',
      // The address and the radius are posted by components the page embeds.
      'src/app/_components/AddressPicker.tsx',
      'src/app/_components/RadiusPicker.tsx',
    );

    const missing = requiredKeys(actions, 'ProfileInput').filter((k) => !posted.has(k));

    expect(missing).toEqual([]);
  });

  it('Neuer Kandidat posts every field CandidateInput requires', () => {
    const posted = postedFields(
      'src/app/kandidat/neu/page.tsx',
      'src/app/_components/AddressPicker.tsx',
      'src/app/_components/RadiusPicker.tsx',
    );

    const missing = requiredKeys(actions, 'CandidateInput').filter((k) => !posted.has(k));

    expect(missing).toEqual([]);
  });

  it('reads the schemas at all — the check is worthless if it finds nothing', () => {
    // A regex that silently matches nothing would make every test above pass.
    expect(requiredKeys(actions, 'ProfileInput')).toContain('maxWarmmieteEuros');
    expect(requiredKeys(actions, 'CandidateInput')).toContain('displayName');
  });
});

/* ------------------------------------------- keine Namen im Browserspeicher --- */

/**
 * Die Felder mit Personendaten dürfen keinen Formularverlauf anlegen.
 *
 * Beim Anlegen des nächsten Kandidaten klappte unter dem Namensfeld ein Menü
 * des Browsers auf und bot die zuletzt getippten Namen an — echte Namen aus
 * anderen Fällen, sichtbar für jeden, der in dem Moment auf den Bildschirm
 * schaut. Gespeichert hat das der Browser, nicht die App, aber verhindern kann
 * es nur die App: ein Feld ohne `autoComplete="off"` wird gemerkt.
 *
 * Und in den Beispieltexten steht kein echter Mensch. Ein Platzhalter ist
 * sichtbar, kopierbar und landet in Screenshots.
 */
describe('Felder mit Personendaten', () => {
  const FILES = [
    'src/app/kandidat/neu/page.tsx',
    'src/app/kandidat/[id]/stammdaten/page.tsx',
    'src/app/kandidat/[id]/profil/page.tsx',
  ];
  const PERSONAL = ['displayName', 'employer'];

  for (const rel of FILES) {
    const src = readFileSync(join(ROOT, rel), 'utf8');

    it(`${rel}: merkt sich nichts`, () => {
      for (const field of PERSONAL) {
        const at = src.indexOf(`name="${field}"`);
        if (at === -1) continue;
        // Das Attribut steht im selben <input …> wie der Name.
        const tag = src.slice(src.lastIndexOf('<input', at), src.indexOf('/>', at));
        expect(`${field}: ${tag}`).toContain('autoComplete="off"');
      }
    });

    it(`${rel}: kein echter Name im Platzhalter`, () => {
      for (const m of src.matchAll(/placeholder="([^"]+)"/g)) {
        // „Vor- und Nachname" ja, „Tanvi Gupta" nein: zwei großgeschriebene
        // Wörter hintereinander sind hier immer ein Mensch oder eine Firma.
        expect(m[1]).not.toMatch(/^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+$/u);
      }
    });
  }
});
