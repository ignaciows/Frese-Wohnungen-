/**
 * The text detector is the part of this tool everything else leans on: if it
 * says "still online" about a flat that was let last week, a colleague writes
 * an Anfrage into the void; if it says "gone" about a live one, the flat is
 * never seen again. So these tests are written from both directions, and the
 * cases that must land in the middle band get as much attention as the clear
 * ones — the middle band is the whole point of reporting a percentage.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVENESS,
  bandOf,
  evaluateLiveness,
  extractPostedAt,
  isDueForCheck,
  livenessScoreFactor,
  nextGoneStreak,
  shouldAutoExpire,
  type LivenessInput,
} from '@/domain/liveness';

const NOW = new Date('2026-08-10T12:00:00Z');

/** A page that looks like a real, live ad. */
const LIVE_PAGE = `
  <html><head><title>3-Zimmer-Wohnung in Heilbronn</title></head>
  <body>
    <h1>Helle 3-Zimmer-Wohnung mit Balkon</h1>
    <dl>
      <dt>Kaltmiete</dt><dd>780 €</dd>
      <dt>Nebenkosten</dt><dd>190 €</dd>
      <dt>Wohnfläche</dt><dd>78 m²</dd>
      <dt>Zimmer</dt><dd>3</dd>
      <dt>Kaution</dt><dd>2.340 €</dd>
    </dl>
    <p>Online seit dem 08.08.2026</p>
    <button>Nachricht schreiben</button>
  </body></html>`;

function read(overrides: Partial<LivenessInput> = {}) {
  return evaluateLiveness({
    requestedUrl: 'https://www.immobilienscout24.de/expose/153627384',
    finalUrl: 'https://www.immobilienscout24.de/expose/153627384',
    status: 200,
    bodySnippet: LIVE_PAGE,
    now: NOW,
    ...overrides,
  });
}

describe('reading a live ad', () => {
  it('confirms a normal listing page with high confidence', () => {
    const r = read();
    expect(r.verdict).toBe('ALIVE');
    expect(r.onlineConfidence).toBeGreaterThanOrEqual(DEFAULT_LIVENESS.aliveAtOrAbove);
  });

  it('explains itself instead of asking to be believed', () => {
    const r = read();
    expect(r.signals.length).toBeGreaterThan(2);
    expect(r.reason).not.toBe('');
  });

  it('reads the publication date off the page', () => {
    const r = read();
    expect(r.posted.at?.toISOString().slice(0, 10)).toBe('2026-08-08');
    expect(r.posted.kind).toBe('PUBLISHED');
    expect(r.posted.label).toContain('08.08.2026');
  });
});

describe('reading an ad that is gone', () => {
  // The case the whole feature exists for: ImmoScout24 serves this as HTTP 200.
  it('catches a soft 404 that answers 200', () => {
    const r = read({
      status: 200,
      bodySnippet:
        '<html><head><title>Angebot nicht gefunden</title></head><body>' +
        '<h1>Angebot nicht gefunden</h1><p>Leider ist bei der Scout-ID etwas schiefgegangen.</p>' +
        '<section>Ähnliche Angebote: 3 Zimmer, Kaltmiete 690 €, Wohnfläche 70 m²</section>' +
        '</body></html>',
    });
    expect(r.verdict).toBe('GONE');
    expect(r.countsTowardsExpiry).toBe(true);
  });

  it('is not talked out of it by the similar-flats block underneath', () => {
    // A gone page still renders prices and contact buttons; that must not lift
    // it back into the live band.
    const r = read({
      bodySnippet:
        '<h1>Diese Anzeige ist nicht mehr verfügbar</h1>' +
        '<p>Kaltmiete 700 € · Nebenkosten 150 € · Wohnfläche 65 m² · Kaution</p>' +
        '<button>Nachricht schreiben</button><p>Online seit dem 01.08.2026</p>',
    });
    expect(r.verdict).toBe('GONE');
    expect(r.onlineConfidence).toBeLessThanOrEqual(DEFAULT_LIVENESS.goneAtOrBelow);
  });

  it('treats a redirect onto the search page as gone', () => {
    const r = read({
      finalUrl: 'https://www.immobilienscout24.de/Suche/de/wohnung-mieten',
      bodySnippet: '<h1>Wohnungen mieten</h1>',
    });
    expect(r.verdict).toBe('GONE');
  });

  it('uses a 404 as evidence rather than as the whole answer', () => {
    const r = read({ status: 404, bodySnippet: '<h1>Seite nicht gefunden</h1>' });
    expect(r.verdict).toBe('GONE');
    // The status contributed, but so did the wording.
    expect(r.signals.filter((s) => s.side === 'GONE').length).toBeGreaterThan(1);
  });
});

describe('the middle band — what must never be hidden', () => {
  it('puts a page it cannot read into limbo rather than guessing', () => {
    // A JavaScript shell: 200, listing URL, but nothing readable on it.
    const r = read({ bodySnippet: '<html><body><div id="app"></div></body></html>' });
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.countsTowardsExpiry).toBe(false);
    expect(r.onlineConfidence).toBeGreaterThan(DEFAULT_LIVENESS.goneAtOrBelow);
    expect(r.onlineConfidence).toBeLessThan(DEFAULT_LIVENESS.aliveAtOrAbove);
  });

  it('reports a percentage a human can act on', () => {
    const r = read({ bodySnippet: '<html><body><div id="app"></div></body></html>' });
    expect(r.reason).toMatch(/\d+ %/);
  });

  it('says 50 % — not "gone" — when nothing came back at all', () => {
    const r = read({ status: null, bodySnippet: null, networkError: 'Zeitüberschreitung' });
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.onlineConfidence).toBe(50);
    expect(r.countsTowardsExpiry).toBe(false);
  });

  it('never retires an ad because a portal blocked us', () => {
    for (const input of [
      { status: 403, bodySnippet: 'Access denied' },
      { status: 429, bodySnippet: 'rate limit' },
      // ImmoScout24 answers a non-browser GET with this, and no auth challenge.
      { status: 401, bodySnippet: '' },
      { status: 200, bodySnippet: '<h1>Just a moment…</h1> checking your browser' },
    ]) {
      const r = read(input);
      expect(r.verdict).toBe('BLOCKED');
      expect(r.countsTowardsExpiry).toBe(false);
      expect(r.onlineConfidence).toBe(50);
    }
  });

  it('does not mistake a big ad page for a bot wall because "captcha" appears in it', () => {
    // A real WG-Gesucht page: 250 KB, a full ad, and the word buried in a
    // script tag. Read naively this came back BLOCKED, which threw away a
    // perfectly good reading — including the posting date it does carry.
    const r = read({
      bodySnippet: `${LIVE_PAGE}<script src="/js/hcaptcha.js"></script>${'<div>x</div>'.repeat(4000)}`,
    });
    expect(r.verdict).toBe('ALIVE');
    expect(r.posted.at).not.toBeNull();
  });

  it('never retires an ad because the portal had a server error', () => {
    const r = read({ status: 503, bodySnippet: 'Service Unavailable' });
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.countsTowardsExpiry).toBe(false);
  });

  it('does not let a stray footer "Seite nicht gefunden" bury a real ad', () => {
    // Portals ship hidden error templates on live pages. Generic 404 wording
    // counts only as a headline, so a complete, dated ad is untouched by it.
    const r = read({ bodySnippet: `${LIVE_PAGE}<div hidden>Seite nicht gefunden</div>` });
    expect(r.verdict).toBe('ALIVE');
  });

  it('but does believe the same wording when it is the page headline', () => {
    const r = read({ bodySnippet: '<title>Seite nicht gefunden</title><h1>Seite nicht gefunden</h1>' });
    expect(r.verdict).not.toBe('ALIVE');
  });
});

describe('publication dates', () => {
  const at = (body: string) => extractPostedAt(body, NOW);

  it('reads the German dotted format', () => {
    expect(at('<p>Eingestellt am 04.08.2026</p>').at?.toISOString().slice(0, 10)).toBe('2026-08-04');
  });

  it('reads a written-out month', () => {
    expect(at('<p>Anzeige vom 4. August 2026</p>').at?.toISOString().slice(0, 10)).toBe('2026-08-04');
  });

  it('reads relative wording', () => {
    expect(at('<p>Online seit 3 Tagen</p>').at?.toISOString().slice(0, 10)).toBe('2026-08-07');
    expect(at('<p>Online seit heute</p>').ageDays).toBe(0);
    expect(at('<p>Online seit gestern</p>').ageDays).toBe(1);
  });

  it('reads schema.org markup when the page renders its date with JavaScript', () => {
    const r = at('<script type="application/ld+json">{"datePosted":"2026-08-05"}</script>');
    expect(r.at?.toISOString().slice(0, 10)).toBe('2026-08-05');
    expect(r.evidence).toContain('datePosted');
  });

  it('prefers the publication date over a later "aktualisiert" bump', () => {
    // A bump is exactly what hides an ad's real age, so it must not win.
    const r = at('<p>Online seit dem 20.07.2026 · Aktualisiert am 10.08.2026</p>');
    expect(r.at?.toISOString().slice(0, 10)).toBe('2026-07-20');
    expect(r.kind).toBe('PUBLISHED');
  });

  it('falls back to the update date when that is all there is', () => {
    expect(at('<p>Zuletzt geändert am 09.08.2026</p>').kind).toBe('UPDATED');
  });

  it('ignores a Baujahr and other stray years', () => {
    expect(at('<dt>Baujahr</dt><dd>1968</dd><p>© 2019 Portal GmbH</p>').at).toBeNull();
  });

  it('ignores an implausible far-past date behind a real cue', () => {
    expect(at('<p>Eingestellt am 04.08.2012</p>').at).toBeNull();
  });

  it('says nothing rather than guessing when the page has no date', () => {
    const r = at('<h1>Schöne Wohnung</h1><p>Kaltmiete 700 €</p>');
    expect(r.at).toBeNull();
    expect(r.label).toBeNull();
  });
});

describe('turning the reading into an ordering', () => {
  const policy = DEFAULT_LIVENESS;

  it('leaves a confirmed ad at full score', () => {
    expect(livenessScoreFactor({ onlineConfidence: 95, postedAt: null }, policy, NOW)).toBe(1);
  });

  it('pushes an uncertain ad below an equally good confirmed one — without hiding it', () => {
    const f = livenessScoreFactor({ onlineConfidence: 50, postedAt: null }, policy, NOW);
    expect(f).toBeLessThan(1);
    expect(f).toBeGreaterThan(0.5);
  });

  it('lifts an ad posted this morning', () => {
    const today = livenessScoreFactor(
      { onlineConfidence: 90, postedAt: new Date('2026-08-10T06:00:00Z') },
      policy,
      NOW,
    );
    expect(today).toBeGreaterThan(1);
  });

  it('sinks an ad that has been up for a month', () => {
    const old = livenessScoreFactor(
      { onlineConfidence: 90, postedAt: new Date('2026-07-05T00:00:00Z') },
      policy,
      NOW,
    );
    expect(old).toBeLessThan(1);
  });
});

describe('bands and retirement', () => {
  const base = { expired: false, lastCheckStatus: 'ALIVE' as string | null };

  it('names the three states a colleague needs to tell apart', () => {
    expect(bandOf({ ...base, onlineConfidence: 90 })).toBe('CONFIRMED');
    expect(bandOf({ ...base, onlineConfidence: 55 })).toBe('LIMBO');
    expect(bandOf({ ...base, onlineConfidence: 10 })).toBe('DEAD');
    expect(bandOf({ ...base, onlineConfidence: null })).toBe('UNCHECKED');
  });

  it('treats a human-retired ad as dead whatever the detector last read', () => {
    expect(bandOf({ expired: true, lastCheckStatus: 'ALIVE', onlineConfidence: 99 })).toBe('DEAD');
  });

  it('needs two strikes before retiring', () => {
    const gone = read({ status: 404, bodySnippet: 'Angebot nicht gefunden' });
    expect(shouldAutoExpire(nextGoneStreak(0, gone), DEFAULT_LIVENESS)).toBe(false);
    expect(shouldAutoExpire(nextGoneStreak(1, gone), DEFAULT_LIVENESS)).toBe(true);
  });

  it('resets the streak on anything inconclusive', () => {
    const blocked = read({ status: 403, bodySnippet: 'Access denied' });
    expect(nextGoneStreak(1, blocked)).toBe(0);
    const limbo = read({ bodySnippet: '<div id="app"></div>' });
    expect(nextGoneStreak(1, limbo)).toBe(0);
  });

  it('only re-checks an ad once the interval has passed', () => {
    const listing = {
      lastCheckedAt: new Date('2026-08-10T06:00:00Z'),
      importedAt: new Date('2026-08-01T00:00:00Z'),
      expired: false,
    };
    expect(isDueForCheck(listing, DEFAULT_LIVENESS, NOW)).toBe(false);
    expect(isDueForCheck({ ...listing, lastCheckedAt: new Date('2026-08-09T00:00:00Z') }, DEFAULT_LIVENESS, NOW)).toBe(true);
  });

  it('leaves retired ads alone so a human can bring them back', () => {
    expect(
      isDueForCheck(
        { lastCheckedAt: null, importedAt: new Date('2026-01-01T00:00:00Z'), expired: true },
        DEFAULT_LIVENESS,
        NOW,
      ),
    ).toBe(false);
  });
});
