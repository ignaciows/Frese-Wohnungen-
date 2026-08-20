/**
 * Kein weißer Bildschirm mehr.
 *
 * Bricht eine Seite oder eine Server-Aktion mit einer Ausnahme ab, zeigt
 * Next.js von sich aus eine leere Seite mit einer englischen Zeile und einer
 * Prüfziffer — „Application error: a server-side exception has occurred.
 * Digest: 3610855577". Kein Weg zurück, keine Navigation, kein Hinweis, ob es
 * an der Eingabe lag. Genau das ist beim Anlegen eines Kandidaten dreimal
 * mitten in der Arbeit passiert.
 *
 * Diese drei Dateien ersetzen das. Sie sind leicht zu verlieren — sie werden
 * von nichts importiert, Next.js findet sie über ihren Namen —, deshalb steht
 * hier, dass es sie gibt und was in ihnen stehen muss.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const lies = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('Fehlerseiten', () => {
  it('es gibt eine Fehlerseite, eine für das Grundgerüst und eine für 404', () => {
    for (const rel of ['src/app/error.tsx', 'src/app/global-error.tsx', 'src/app/not-found.tsx']) {
      expect(existsSync(join(ROOT, rel)), rel).toBe(true);
    }
  });

  it('die Fehlerseiten laufen im Browser — sonst greifen sie nicht', () => {
    // `error.tsx` muss eine Client-Komponente sein: Next.js reicht ihr eine
    // `reset()`-Funktion, und die gibt es auf dem Server nicht.
    for (const rel of ['src/app/error.tsx', 'src/app/global-error.tsx']) {
      expect(lies(rel).startsWith("'use client'"), rel).toBe(true);
    }
  });

  it('jede Fehlerseite bietet einen Weg weiter', () => {
    expect(lies('src/app/error.tsx')).toContain('reset');
    expect(lies('src/app/error.tsx')).toContain('href="/"');
    expect(lies('src/app/global-error.tsx')).toContain('reset');
    expect(lies('src/app/not-found.tsx')).toContain('href="/"');
  });

  it('das Grundgerüst bringt html und body selbst mit', () => {
    // Greift `global-error.tsx`, steht kein Layout mehr — ohne eigenes
    // `<html>` bleibt der Bildschirm wieder weiß.
    const src = lies('src/app/global-error.tsx');
    expect(src).toMatch(/<html/);
    expect(src).toMatch(/<body/);
  });

  it('und sie reden Deutsch', () => {
    expect(lies('src/app/error.tsx')).toContain('Da ist etwas schiefgegangen');
    expect(lies('src/app/not-found.tsx')).toContain('Diese Seite gibt es nicht');
  });
});
