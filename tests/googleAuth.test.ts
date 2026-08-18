/**
 * Anmelden mit Google — die Regeln, bei denen ein Fehler teuer ist.
 *
 * Ein Login, das jedes Google-Konto der Welt akzeptiert, ist kein Login, und
 * ein Anmeldevorgang, der Rollen vergibt, ist eine Hintertür. Beides sieht im
 * Betrieb völlig normal aus, bis es das nicht mehr tut — deshalb steht es hier
 * und nicht nur im Kommentar.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  appOrigin,
  authorizeUrl,
  domainAllowed,
  googleConfig,
  googleLoginEnabled,
  redirectUri,
  type GoogleConfig,
} from '@/lib/googleAuth';

const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_ALLOWED_DOMAIN', 'APP_URL'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function configure(extra: Record<string, string> = {}) {
  process.env.GOOGLE_CLIENT_ID = 'client-id-123';
  process.env.GOOGLE_CLIENT_SECRET = 'secret-abc';
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
}

const config: GoogleConfig = {
  clientId: 'client-id-123',
  clientSecret: 'secret-abc',
  allowedDomain: 'frese-recruiting.de',
};

describe('ist der Google-Login überhaupt eingerichtet', () => {
  it('bleibt aus, solange keine Zugangsdaten hinterlegt sind', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(googleConfig()).toBeNull();
    expect(googleLoginEnabled()).toBe(false);
  });

  it('braucht beides — eine ID allein reicht nicht', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.GOOGLE_CLIENT_ID = 'client-id-123';
    expect(googleConfig()).toBeNull();
  });

  it('liest die erlaubte Domain, mit oder ohne @ davor', () => {
    configure({ GOOGLE_ALLOWED_DOMAIN: '@Frese-Recruiting.DE' });
    expect(googleConfig()?.allowedDomain).toBe('frese-recruiting.de');
  });
});

describe('wer ein Konto bekommen darf', () => {
  it('nur Adressen der eigenen Domain', () => {
    expect(domainAllowed('kollegin@frese-recruiting.de', config)).toBe(true);
    expect(domainAllowed('fremd@gmail.com', config)).toBe(false);
  });

  it('lässt sich nicht mit der Domain als Präfix austricksen', () => {
    // "frese-recruiting.de.angreifer.com" endet nicht auf "@frese-recruiting.de".
    expect(domainAllowed('x@frese-recruiting.de.angreifer.com', config)).toBe(false);
    expect(domainAllowed('x@notfrese-recruiting.de', config)).toBe(false);
  });

  it('legt ohne konfigurierte Domain niemanden an', () => {
    // Sonst wäre der Standardzustand „jedes Google-Konto der Welt".
    const open: GoogleConfig = { ...config, allowedDomain: null };
    expect(domainAllowed('irgendwer@gmail.com', open)).toBe(false);
    expect(domainAllowed('kollegin@frese-recruiting.de', open)).toBe(false);
  });
});

describe('die Adresse, zu der Google zurückschickt', () => {
  it('nimmt APP_URL und nicht den Host-Header der Anfrage', () => {
    // Der Host-Header lässt sich fälschen; die redirect_uri muss exakt der in
    // der Cloud Console eingetragenen entsprechen.
    configure({ APP_URL: 'https://wohnungen.frese.de' });
    expect(appOrigin('https://boeser-host.example/google/start')).toBe('https://wohnungen.frese.de');
    expect(redirectUri('https://boeser-host.example/google/start')).toBe(
      'https://wohnungen.frese.de/google/callback',
    );
  });

  it('fällt ohne APP_URL auf den Origin der Anfrage zurück', () => {
    configure();
    delete process.env.APP_URL;
    expect(appOrigin('https://localhost:3000/google/start')).toBe('https://localhost:3000');
  });

  it('verträgt einen abschließenden Schrägstrich in APP_URL', () => {
    configure({ APP_URL: 'https://wohnungen.frese.de/' });
    expect(redirectUri('https://x/')).toBe('https://wohnungen.frese.de/google/callback');
  });
});

describe('die URL zu Google', () => {
  const url = () =>
    new URL(authorizeUrl({ config, requestUrl: 'https://wohnungen.frese.de/google/start', state: 'st-1' }));

  it('fragt nur nach Identität, nicht nach Postfach oder Kalender', () => {
    // Das Postfach läuft über IMAP unter „Konten & Postfach". Ein Login, das
    // sich nebenbei Zugriff auf Mails geben lässt, ist kein Login mehr.
    expect(url().searchParams.get('scope')).toBe('openid email profile');
  });

  it('trägt den state gegen CSRF mit', () => {
    expect(url().searchParams.get('state')).toBe('st-1');
  });

  it('erzwingt die Kontoauswahl', () => {
    // Auf einem geteilten Rechner meldet Google sonst still das zuletzt
    // benutzte private Konto an.
    expect(url().searchParams.get('prompt')).toBe('select_account');
  });

  it('nennt Google die erwartete Domain und den Rücksprung', () => {
    expect(url().searchParams.get('hd')).toBe('frese-recruiting.de');
    expect(url().searchParams.get('redirect_uri')).toBe('https://wohnungen.frese.de/google/callback');
    expect(url().searchParams.get('response_type')).toBe('code');
  });
});
