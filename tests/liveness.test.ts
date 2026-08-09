import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVENESS,
  evaluateLiveness,
  isDueForCheck,
  nextGoneStreak,
  shouldAutoExpire,
} from '@/domain/liveness';
import { assertPublicUrl, BlockedUrlError } from '@/lib/safeFetch';

const EXPOSE = 'https://www.immobilienscout24.de/expose/153627384';

function check(over: Partial<Parameters<typeof evaluateLiveness>[0]> = {}) {
  return evaluateLiveness({
    requestedUrl: EXPOSE,
    finalUrl: EXPOSE,
    status: 200,
    bodySnippet: '<html>Schöne Wohnung mit Balkon</html>',
    ...over,
  });
}

describe('liveness verdicts', () => {
  it('a normal listing page is ALIVE', () => {
    expect(check().verdict).toBe('ALIVE');
  });

  it('404 means GONE and may expire the listing', () => {
    const r = check({ status: 404 });
    expect(r.verdict).toBe('GONE');
    expect(r.countsTowardsExpiry).toBe(true);
  });

  it('410 means GONE', () => {
    expect(check({ status: 410 }).verdict).toBe('GONE');
  });

  it('detects the German "no longer available" notice behind a 200', () => {
    const r = check({ bodySnippet: 'Dieses Angebot ist nicht mehr verfügbar.' });
    expect(r.verdict).toBe('GONE');
    expect(r.reason).toContain('nicht mehr verfügbar');
  });

  it('detects a soft 404 that redirects to the search page', () => {
    const r = check({ finalUrl: 'https://www.immobilienscout24.de/Suche/de/wohnung-mieten' });
    expect(r.verdict).toBe('GONE');
    expect(r.reason).toContain('Suche');
  });

  it('a redirect to another expose page is still ALIVE', () => {
    const r = check({ finalUrl: 'https://www.immobilienscout24.de/expose/153627384?utm=1' });
    expect(r.verdict).toBe('ALIVE');
  });
});

describe('liveness never guesses when it cannot tell', () => {
  it('403 is BLOCKED, not GONE', () => {
    const r = check({ status: 403 });
    expect(r.verdict).toBe('BLOCKED');
    expect(r.countsTowardsExpiry).toBe(false);
  });

  it('429 throttling is BLOCKED', () => {
    expect(check({ status: 429 }).verdict).toBe('BLOCKED');
  });

  it('a captcha wall served as 200 is BLOCKED, not GONE', () => {
    const r = check({ bodySnippet: 'Bitte bestätigen Sie: Sind Sie ein Mensch? captcha' });
    expect(r.verdict).toBe('BLOCKED');
    expect(r.countsTowardsExpiry).toBe(false);
  });

  it('a server error is UNKNOWN', () => {
    const r = check({ status: 503 });
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.countsTowardsExpiry).toBe(false);
  });

  it('a timeout is UNKNOWN', () => {
    const r = check({ status: null, networkError: 'Zeitüberschreitung' });
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.countsTowardsExpiry).toBe(false);
  });
});

describe('auto-expiry needs repeated confident evidence', () => {
  it('one GONE is not enough with the default policy', () => {
    const streak = nextGoneStreak(0, check({ status: 404 }));
    expect(streak).toBe(1);
    expect(shouldAutoExpire(streak, DEFAULT_LIVENESS)).toBe(false);
  });

  it('two consecutive GONE results expire the listing', () => {
    let streak = nextGoneStreak(0, check({ status: 404 }));
    streak = nextGoneStreak(streak, check({ status: 404 }));
    expect(shouldAutoExpire(streak, DEFAULT_LIVENESS)).toBe(true);
  });

  it('a BLOCKED result resets the streak — a blocked portal can never expire an ad', () => {
    let streak = nextGoneStreak(0, check({ status: 404 }));
    streak = nextGoneStreak(streak, check({ status: 403 }));
    expect(streak).toBe(0);
    expect(shouldAutoExpire(streak, DEFAULT_LIVENESS)).toBe(false);
  });

  it('an ALIVE result resets the streak', () => {
    const streak = nextGoneStreak(3, check());
    expect(streak).toBe(0);
  });
});

describe('scheduling', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it('a freshly checked listing is not due', () => {
    const due = isDueForCheck(
      { lastCheckedAt: hoursAgo(1), importedAt: hoursAgo(48), expired: false },
      DEFAULT_LIVENESS,
      now,
    );
    expect(due).toBe(false);
  });

  it('becomes due after the interval', () => {
    const due = isDueForCheck(
      { lastCheckedAt: hoursAgo(20), importedAt: hoursAgo(48), expired: false },
      DEFAULT_LIVENESS,
      now,
    );
    expect(due).toBe(true);
  });

  it('a never-checked listing falls back to its import time', () => {
    const due = isDueForCheck(
      { lastCheckedAt: null, importedAt: hoursAgo(30), expired: false },
      DEFAULT_LIVENESS,
      now,
    );
    expect(due).toBe(true);
  });

  it('expired listings are left alone', () => {
    const due = isDueForCheck(
      { lastCheckedAt: null, importedAt: hoursAgo(500), expired: true },
      DEFAULT_LIVENESS,
      now,
    );
    expect(due).toBe(false);
  });

  it('nothing is due when the checker is switched off', () => {
    const due = isDueForCheck(
      { lastCheckedAt: null, importedAt: hoursAgo(500), expired: false },
      { ...DEFAULT_LIVENESS, enabled: false },
      now,
    );
    expect(due).toBe(false);
  });
});

describe('SSRF guard', () => {
  it('allows a normal public URL', async () => {
    await expect(assertPublicUrl('https://example.com/expose/1')).resolves.toBeInstanceOf(URL);
  });

  it('rejects non-http protocols', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('rejects localhost', async () => {
    await expect(assertPublicUrl('http://localhost:3000/x')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('rejects loopback and private ranges by literal IP', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl('http://10.0.0.5/')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl('http://192.168.1.1/')).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl('http://172.16.4.4/')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('rejects the cloud metadata address', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
  });

  it('rejects IPv6 loopback', async () => {
    await expect(assertPublicUrl('http://[::1]/')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('rejects garbage input', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toBeInstanceOf(BlockedUrlError);
  });
});
