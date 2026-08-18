/**
 * Anmelden mit Google.
 *
 * Warum von Hand statt mit einer Auth-Bibliothek: die Sitzung existiert schon
 * (iron-session, ein verschlüsseltes Cookie mit einer Nutzer-ID darin), und
 * OAuth mit Authorization Code ist genau drei HTTP-Aufrufe. Eine Bibliothek
 * hätte hier ihr eigenes Sitzungsmodell mitgebracht, das zweite neben dem
 * bestehenden — und zwei Wahrheiten darüber, wer angemeldet ist, ist der
 * Anfang jedes Auth-Fehlers.
 *
 * Drei Regeln, die hier festverdrahtet sind und es bleiben sollten:
 *
 *  1. **Nur die eigene Domain.** Ohne `GOOGLE_ALLOWED_DOMAIN` legt niemand ein
 *     Konto an; mit ihr nur, wer eine Adresse dieser Domain hat. Ein Login mit
 *     Google, das jedes Google-Konto der Welt akzeptiert, ist kein Login.
 *  2. **Niemand wird von selbst Admin.** Ein neu angelegtes Konto ist immer
 *     COLLEAGUE. Rollen vergibt ein Mensch.
 *  3. **Die E-Mail muss von Google bestätigt sein.** Sonst ist die Adresse
 *     eine Behauptung und keine Identität.
 *
 * Ist nichts konfiguriert, existiert der ganze Weg nicht: der Knopf erscheint
 * nicht, die Routen antworten mit 404. Passwort-Login läuft unverändert weiter.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Pfad, den Google nach der Anmeldung aufruft. Muss in der Cloud Console genau so eingetragen sein. */
export const GOOGLE_CALLBACK_PATH = '/google/callback';

/** Cookie, in dem der CSRF-Zustand zwischen Start und Rückkehr liegt. */
export const STATE_COOKIE = 'frese_google_state';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /**
   * Erlaubte E-Mail-Domain, z. B. "frese-recruiting.de". Leer = es werden
   * keine Konten angelegt; anmelden kann sich dann nur, wer schon angelegt ist.
   */
  allowedDomain: string | null;
}

/** Die Konfiguration, oder null wenn Google-Login nicht eingerichtet ist. */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    allowedDomain: process.env.GOOGLE_ALLOWED_DOMAIN?.trim().toLowerCase().replace(/^@/, '') || null,
  };
}

export function googleLoginEnabled(): boolean {
  return googleConfig() !== null;
}

/**
 * Die Adresse, unter der die App erreichbar ist.
 *
 * Fest aus `APP_URL`, mit dem Origin der Anfrage als Rückfallebene: Google
 * verlangt, dass die `redirect_uri` exakt der eingetragenen entspricht, und
 * der `Host`-Header lässt sich fälschen. In der Produktion gehört `APP_URL`
 * gesetzt.
 */
export function appOrigin(requestUrl: string): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  return new URL(requestUrl).origin;
}

export function redirectUri(requestUrl: string): string {
  return `${appOrigin(requestUrl)}${GOOGLE_CALLBACK_PATH}`;
}

/** Die URL, zu der der Anmelde-Knopf schickt. */
export function authorizeUrl(args: { config: GoogleConfig; requestUrl: string; state: string }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', args.config.clientId);
  url.searchParams.set('redirect_uri', redirectUri(args.requestUrl));
  url.searchParams.set('response_type', 'code');
  // Nur Identität. Kein Zugriff auf Kalender, Kontakte oder Postfach — dafür
  // gibt es den IMAP-Zugang unter „Konten & Postfach".
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', args.state);
  // Konto-Auswahl erzwingen: sonst meldet Google stillschweigend das zuletzt
  // benutzte private Konto an, was auf einem geteilten Rechner falsch ist.
  url.searchParams.set('prompt', 'select_account');
  if (args.config.allowedDomain) {
    // Nur ein Vorschlag an Googles Kontoauswahl, keine Sicherheitsgrenze —
    // geprüft wird die Domain unten noch einmal selbst.
    url.searchParams.set('hd', args.config.allowedDomain);
  }
  return url.toString();
}

export interface GoogleIdentity {
  googleId: string;
  email: string;
  name: string;
}

/**
 * Tauscht den Code gegen die Identität des Anmeldenden.
 *
 * Die Nutzerdaten kommen über den `userinfo`-Endpunkt und nicht aus dem
 * id_token: das spart das Prüfen einer JWT-Signatur, und beide Aufrufe gehen
 * direkt und über TLS an Google — es gibt hier nichts, dem man mehr oder
 * weniger trauen würde.
 *
 * Wirft nie; gibt bei jedem Fehler einen deutschen Grund zurück.
 */
export async function exchangeCodeForIdentity(args: {
  config: GoogleConfig;
  code: string;
  requestUrl: string;
}): Promise<{ ok: true; identity: GoogleIdentity } | { ok: false; reason: string }> {
  try {
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: args.code,
        client_id: args.config.clientId,
        client_secret: args.config.clientSecret,
        redirect_uri: redirectUri(args.requestUrl),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      return { ok: false, reason: 'Google hat den Anmelde-Code abgelehnt.' };
    }
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) return { ok: false, reason: 'Google hat kein Zugriffstoken geliefert.' };

    const infoRes = await fetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!infoRes.ok) return { ok: false, reason: 'Profil konnte bei Google nicht gelesen werden.' };

    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (!info.sub || !info.email) return { ok: false, reason: 'Google hat keine E-Mail-Adresse geliefert.' };
    // Eine unbestätigte Adresse ist eine Behauptung, keine Identität.
    if (info.email_verified === false) {
      return { ok: false, reason: 'Diese Google-Adresse ist nicht bestätigt.' };
    }

    const email = info.email.trim().toLowerCase();
    return {
      ok: true,
      identity: { googleId: info.sub, email, name: info.name?.trim() || email.split('@')[0] },
    };
  } catch {
    return { ok: false, reason: 'Google war nicht erreichbar.' };
  }
}

/** Gehört die Adresse zur erlaubten Domain? Ohne konfigurierte Domain: nein. */
export function domainAllowed(email: string, config: GoogleConfig): boolean {
  if (!config.allowedDomain) return false;
  return email.endsWith(`@${config.allowedDomain}`);
}
