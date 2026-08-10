/**
 * robots.txt handling is the part of the crawler that keeps us welcome, so it
 * is tested against the real file from the busiest source rather than a toy
 * example — that file is where the surprising rules live.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseRobots, isAllowed, isBlockPage } from '@/server/crawler';

describe('robots.txt parsing', () => {
  it('reads a simple group', () => {
    const rules = parseRobots(`User-agent: *\nDisallow: /admin/\nAllow: /admin/public\nCrawl-delay: 3`);
    expect(rules.crawlDelayMs).toBe(3000);
    expect(isAllowed('/', rules)).toBe(true);
    expect(isAllowed('/admin/secret', rules)).toBe(false);
    // A longer Allow beats a shorter Disallow.
    expect(isAllowed('/admin/public/page', rules)).toBe(true);
  });

  it('prefers a group naming us over the wildcard', () => {
    const rules = parseRobots(
      `User-agent: *\nDisallow: /\n\nUser-agent: FreseWohnungBot\nDisallow: /intern/`,
    );
    expect(isAllowed('/suche', rules)).toBe(true);
    expect(isAllowed('/intern/x', rules)).toBe(false);
  });

  it('treats an empty Disallow as "everything is allowed"', () => {
    expect(isAllowed('/anything', parseRobots(`User-agent: *\nDisallow:`))).toBe(true);
  });

  it('honours * and $ wildcards', () => {
    const rules = parseRobots(`User-agent: *\nDisallow: /*/print$\nDisallow: /tmp*`);
    expect(isAllowed('/a/print', rules)).toBe(false);
    // The $ anchors the end, so a longer path is untouched.
    expect(isAllowed('/a/print/page', rules)).toBe(true);
    expect(isAllowed('/tmpfiles/x', rules)).toBe(false);
  });

  it('caps an unreasonable crawl-delay instead of stalling a sweep', () => {
    expect(parseRobots(`User-agent: *\nCrawl-delay: 600`).crawlDelayMs).toBe(30_000);
  });

  it('ignores comments and blank lines', () => {
    const rules = parseRobots(`# comment\n\nUser-agent: *  # us\nDisallow: /x/ # nope\n`);
    expect(isAllowed('/x/1', rules)).toBe(false);
    expect(isAllowed('/y/1', rules)).toBe(true);
  });

  it('starts a new group when a user-agent follows directives', () => {
    const rules = parseRobots(`User-agent: badbot\nDisallow: /\nUser-agent: *\nDisallow: /nope`);
    // The blanket "/" belongs to badbot, not to us.
    expect(isAllowed('/suche', rules)).toBe(true);
    expect(isAllowed('/nope', rules)).toBe(false);
  });

  describe('against the live Kleinanzeigen file', () => {
    const rules = parseRobots(readFileSync(join(__dirname, 'fixtures', 'kleinanzeigen-robots.txt'), 'utf8'));

    it('permits the plain city search, its pages and detail pages', () => {
      expect(isAllowed('/s-wohnung-mieten/heilbronn/c203l9228', rules)).toBe(true);
      expect(isAllowed('/s-wohnung-mieten/seite:2/heilbronn/c203l9228', rules)).toBe(true);
      expect(isAllowed('/s-anzeige/schoene-wohnung/3443198600-203-9245', rules)).toBe(true);
    });

    it('forbids exactly the shortcuts it would be tempting to take', () => {
      // Each of these is why the adapter filters in our own ranking instead.
      expect(isAllowed('/s-wohnung-mieten/heilbronn/preis::900/c203l9228', rules)).toBe(false);
      expect(isAllowed('/s-wohnung-mieten/heilbronn/anzeige:angebote/c203l9228', rules)).toBe(false);
      expect(isAllowed('/s-wohnung-mieten/heilbronn/c203l9228r20', rules)).toBe(false);
      expect(isAllowed('/s-ort-empfehlungen.json', rules)).toBe(false);
    });
  });
});

describe('block detection', () => {
  it('spots anti-bot walls served as a normal page', () => {
    expect(isBlockPage('<html><body>Please complete the CAPTCHA to continue</body></html>')).toBe(true);
    expect(isBlockPage('<title>Just a moment...</title>')).toBe(true);
    expect(isBlockPage('<html><body>Zugriff verweigert</body></html>')).toBe(true);
  });

  it('does not mistake an ordinary results page for a wall', () => {
    expect(isBlockPage('<html><body>27 Mietwohnungen in Heilbronn</body></html>')).toBe(false);
  });
});
