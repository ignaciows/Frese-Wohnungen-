/**
 * Farben, die es gar nicht gibt.
 *
 * `color: var(--muted)` sieht aus wie eine Farbe. Ist `--muted` nirgends
 * gesetzt, ist die ganze Zeile ungültig und CSS fällt auf „erben" zurück — der
 * Text nimmt die Farbe seines Kastens an. Sichtbar wird das nie als Fehler,
 * sondern als Absatz, der zu dunkel, zu hell oder schlicht anders ist als
 * gemeint. Zehn solcher Zeilen standen in dieser Datei, alle aus Umbauten, bei
 * denen die Namen der Farbtöne einmal gewechselt haben.
 *
 * Ausgenommen ist `--font-ui`: die setzt next/font zur Laufzeit am
 * html-Element, nicht das Stylesheet.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, '..', 'src/app/globals.css'), 'utf8');

/** Von außen gesetzt, deshalb hier nicht deklariert. */
const VON_AUSSEN = new Set(['--font-ui']);

describe('globals.css', () => {
  it('benutzt keine Variable, die nirgends gesetzt ist', () => {
    const benutzt = new Set([...CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const gesetzt = new Set([...CSS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
    const fehlend = [...benutzt].filter((v) => !gesetzt.has(v) && !VON_AUSSEN.has(v));
    expect(fehlend).toEqual([]);
  });

  it('setzt jeden Farbton auch im dunklen Thema', () => {
    // Ein Ton, den nur das helle Thema kennt, ist im dunklen entweder falsch
    // oder unsichtbar — genau so stand weiße Schrift auf hellem Grund.
    const hell = new Set(
      [...CSS.slice(0, CSS.indexOf("[data-theme='dark']")).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    );
    const dunkel = new Set(
      [...CSS.slice(CSS.indexOf(":root[data-theme='dark']")).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    );
    // Nur die Töne, die im Dunkeln zwingend anders sein müssen.
    for (const ton of ['--tab-ink', '--tab-count-bg', '--tab-count-ink', '--text', '--surface', '--brand']) {
      expect(hell.has(ton), `hell: ${ton}`).toBe(true);
      expect(dunkel.has(ton), `dunkel: ${ton}`).toBe(true);
    }
  });

  it('der aktive Reiter bekommt Fläche und Schrift in derselben Regel', () => {
    // Der Fehler, der „Ergebnisse" weiß auf Fast-Weiß gestellt hat: eine
    // Regel färbte, eine andere legte die Fläche darunter.
    const regeln = [...CSS.matchAll(/\.tab\[aria-current='page'\]\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(regeln.length).toBeGreaterThan(0);
    for (const r of regeln) {
      // `border-bottom-color` enthält „color:" — gemeint ist die Schriftfarbe.
      if (/background/.test(r)) expect(r, r).toMatch(/(^|[\s;{])color\s*:/);
    }
  });
});
