/**
 * Ein Google-Postfach anbinden.
 *
 * Zwei Dinge werden hier festgehalten, weil beide Fehler erst am nächsten Tag
 * auffallen würden:
 *
 *  1. Der Anfrage-Link muss `access_type=offline` und `prompt=consent`
 *     mitschicken. Ohne beides gibt Google beim zweiten Verbinden keinen
 *     Refresh-Token mehr, und das Postfach fällt nach einer Stunde stumm aus.
 *  2. Ein widerrufener Zugriff muss vom „Google war kurz weg" unterscheidbar
 *     sein — das eine braucht einen Menschen, das andere wartet sich aus.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GMAIL_HOSTS,
  exchangeCodeForMailbox,
  freshAccessToken,
  mailboxAuthorizeUrl,
  mailboxRedirectUri,
} from '@/lib/googleMailbox';

const config = { clientId: 'client-123', clientSecret: 'geheim' };
const requestUrl = 'https://app.example/google/postfach/start';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.APP_URL;
});

/** Antwortet der Reihe nach mit den übergebenen Antworten. */
function stubFetch(...responses: Array<{ status?: number; body?: unknown; ok?: boolean }>) {
  const queue = [...responses];
  const fetchMock = vi.fn(async () => {
    const r = queue.shift() ?? { status: 500, body: {} };
    const status = r.status ?? 200;
    return {
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      json: async () => r.body ?? {},
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('der Link zu Google', () => {
  it('fragt nach dauerhaftem Zugriff', () => {
    // Der ganze Grund für diesen Test: ohne diese beiden Parameter läuft alles
    // durch, sieht grün aus, und ist eine Stunde später tot.
    const url = new URL(mailboxAuthorizeUrl({ config, requestUrl, state: 'abc' }));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toContain('consent');
  });

  it('fragt nach Postfach-Zugriff und nicht nur nach der Identität', () => {
    const url = new URL(mailboxAuthorizeUrl({ config, requestUrl, state: 'abc' }));
    expect(url.searchParams.get('scope')).toContain('https://mail.google.com/');
  });

  it('nimmt die konfigurierte Adresse und nicht den Host der Anfrage', () => {
    // Der Host-Header lässt sich fälschen, und Google verlangt eine exakt
    // eingetragene Rücksprungadresse.
    process.env.APP_URL = 'https://echt.example';
    expect(mailboxRedirectUri('https://gefaelscht.example/x')).toBe(
      'https://echt.example/google/postfach/callback',
    );
  });

  it('trägt den Zufallswert gegen CSRF mit', () => {
    const url = new URL(mailboxAuthorizeUrl({ config, requestUrl, state: 'zufall-1' }));
    expect(url.searchParams.get('state')).toBe('zufall-1');
  });
});

describe('den Code eintauschen', () => {
  it('liefert Refresh-Token und Adresse', async () => {
    stubFetch(
      { body: { access_token: 'at-1', refresh_token: 'rt-1' } },
      { body: { email: 'Wohnen@Frese.DE' } },
    );
    const result = await exchangeCodeForMailbox({ config, code: 'c', requestUrl });
    expect(result).toEqual({ ok: true, grant: { email: 'wohnen@frese.de', refreshToken: 'rt-1' } });
  });

  it('sagt, was zu tun ist, wenn Google keinen Refresh-Token schickt', async () => {
    // Passiert, wenn dasselbe Konto schon einmal zugestimmt hat. Ohne den
    // Hinweis sucht jemand eine Stunde.
    stubFetch({ body: { access_token: 'at-1' } });
    const result = await exchangeCodeForMailbox({ config, code: 'c', requestUrl });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/Drittanbieter-Zugriff/);
  });

  it('bleibt ruhig, wenn Google gar nicht erreichbar ist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const result = await exchangeCodeForMailbox({ config, code: 'c', requestUrl });
    expect(result).toEqual({ ok: false, reason: 'Google war nicht erreichbar.' });
  });
});

describe('ein frisches Zugriffstoken', () => {
  it('holt eines', async () => {
    stubFetch({ body: { access_token: 'at-2' } });
    expect(await freshAccessToken({ config, refreshToken: 'rt' })).toEqual({
      ok: true,
      accessToken: 'at-2',
    });
  });

  it('unterscheidet „Zugriff entzogen" von „gerade gestört"', async () => {
    stubFetch({ status: 400 });
    const revoked = await freshAccessToken({ config, refreshToken: 'rt' });
    expect(revoked.ok === false && revoked.needsReconnect).toBe(true);

    stubFetch({ status: 503 });
    const hiccup = await freshAccessToken({ config, refreshToken: 'rt' });
    expect(hiccup.ok === false && hiccup.needsReconnect).toBe(false);
  });

  it('behandelt einen Netzwerkfehler nicht als Widerruf', async () => {
    // Sonst schaltet ein Aussetzer im Netz das Postfach ab und jemand muss es
    // von Hand wieder verbinden, obwohl nie etwas kaputt war.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT'); }));
    const result = await freshAccessToken({ config, refreshToken: 'rt' });
    expect(result.ok === false && result.needsReconnect).toBe(false);
  });
});

describe('die Serverdaten', () => {
  it('stehen fest, damit niemand sie abtippt', () => {
    expect(GMAIL_HOSTS.imapHost).toBe('imap.gmail.com');
    expect(GMAIL_HOSTS.smtpHost).toBe('smtp.gmail.com');
    expect(GMAIL_HOSTS.smtpSecure).toBe(true);
  });
});
