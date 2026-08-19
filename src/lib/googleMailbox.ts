/**
 * Ein Google-Postfach anbinden — ohne Passwort.
 *
 * Das ist nicht dasselbe wie „Anmelden mit Google" (`lib/googleAuth.ts`).
 * Dort geht es darum, *wer* vor dem Bildschirm sitzt; hier darum, dass die App
 * ein Postfach lesen und daraus verschicken darf. Zwei Fragen, zwei Zustimmungen,
 * zwei Berechtigungen — und deshalb bewusst zwei Dateien, auch wenn beide
 * dieselbe Client-ID benutzen.
 *
 * Der Weg vorher war: bei Google die Zwei-Faktor-Anmeldung einschalten, ein
 * App-Passwort erzeugen, `imap.gmail.com`, Port 993, `smtp.gmail.com`, Port
 * 587 abtippen und hoffen. Fünf Felder, von denen vier immer gleich sind, und
 * ein Passwort im Klartext durch die Zwischenablage. Jetzt: ein Knopf.
 *
 * Zwei Dinge, die hier festverdrahtet sind:
 *
 *  1. **`access_type=offline` und `prompt=consent`.** Ohne beides schickt
 *     Google beim zweiten Verbinden keinen Refresh-Token mehr, und das
 *     Postfach fällt nach einer Stunde stumm aus — ein Fehler, der erst am
 *     nächsten Tag auffällt.
 *  2. **Gespeichert wird nur der Refresh-Token.** Access-Token halten eine
 *     Stunde; sie in die Datenbank zu schreiben hieße, ständig veraltete
 *     Geheimnisse aufzubewahren. Geholt werden sie, wenn sie gebraucht werden.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Pfad, den Google nach der Zustimmung aufruft. Muss in der Cloud Console genau so stehen. */
export const MAILBOX_CALLBACK_PATH = '/google/postfach/callback';

/** Cookie, in dem der CSRF-Zustand zwischen Start und Rückkehr liegt. */
export const MAILBOX_STATE_COOKIE = 'frese_google_postfach';

/**
 * Voller Postfach-Zugriff über IMAP und SMTP.
 *
 * Google bietet feinere Rechte an (`gmail.readonly`, `gmail.send`), aber die
 * gelten nur für die Gmail-API. Wer über IMAP liest und über SMTP verschickt —
 * und genau das tut diese App, weil es auch mit jedem anderen Anbieter
 * funktioniert — braucht `https://mail.google.com/`. Ein zweiter Zugangsweg
 * nur für Google wäre der teurere Preis.
 */
const SCOPE = 'https://mail.google.com/ openid email';

/** Feste Serverdaten. Niemand soll „imap.gmail.com" abtippen müssen. */
export const GMAIL_HOSTS = {
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapSecure: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpSecure: true,
} as const;

export interface MailboxOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Die Konfiguration, oder null wenn der Weg nicht eingerichtet ist.
 *
 * Bewusst dieselben Umgebungsvariablen wie beim Anmelden: es ist dasselbe
 * Google-Projekt, und zwei Sätze Zugangsdaten für ein Projekt sind eine
 * Fehlerquelle ohne Gegenwert. Wer nur eines von beidem will, schaltet das
 * andere in Google selbst nicht frei.
 */
export function mailboxOAuthConfig(): MailboxOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function googleMailboxEnabled(): boolean {
  return mailboxOAuthConfig() !== null;
}

/** Die Adresse, unter der die App erreichbar ist. Siehe `lib/googleAuth`. */
export function appOrigin(requestUrl: string): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  return new URL(requestUrl).origin;
}

export function mailboxRedirectUri(requestUrl: string): string {
  return `${appOrigin(requestUrl)}${MAILBOX_CALLBACK_PATH}`;
}

/** Wohin der Knopf „Mit Google verbinden" schickt. */
export function mailboxAuthorizeUrl(args: {
  config: MailboxOAuthConfig;
  requestUrl: string;
  state: string;
  /** Adresse, die schon verbunden war — beim Neuverbinden. */
  loginHint?: string | null;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', args.config.clientId);
  url.searchParams.set('redirect_uri', mailboxRedirectUri(args.requestUrl));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', args.state);
  // Beides zwingend, siehe Kopf der Datei: ohne offline + consent kommt beim
  // zweiten Verbinden kein Refresh-Token mehr.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  // Beim Neuverbinden das Konto vorschlagen, das kaputt ist. Ohne das wählt
  // jemand im Zweifel das falsche, und dann steht ein zweites, funktionierendes
  // Postfach in der Liste — während das kaputte weiter kaputt ist und niemand
  // sagt warum. Nur ein Vorschlag; wer will, wählt trotzdem ein anderes.
  if (args.loginHint) url.searchParams.set('login_hint', args.loginHint);
  return url.toString();
}

export interface MailboxGrant {
  /** Adresse des verbundenen Postfachs. */
  email: string;
  /** Das Dauerhafte. Wird verschlüsselt gespeichert. */
  refreshToken: string;
}

/**
 * Tauscht den Code gegen einen Refresh-Token und die Adresse des Postfachs.
 *
 * Wirft nie; gibt bei jedem Fehler einen deutschen Grund zurück.
 */
export async function exchangeCodeForMailbox(args: {
  config: MailboxOAuthConfig;
  code: string;
  requestUrl: string;
}): Promise<{ ok: true; grant: MailboxGrant } | { ok: false; reason: string }> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: args.code,
        client_id: args.config.clientId,
        client_secret: args.config.clientSecret,
        redirect_uri: mailboxRedirectUri(args.requestUrl),
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) return { ok: false, reason: 'Google hat den Zugriffs-Code abgelehnt.' };

    const token = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!token.refresh_token) {
      // Passiert, wenn dasselbe Konto schon einmal zugestimmt hat und
      // `prompt=consent` fehlt. Mit dem Hinweis ist es in einer Minute
      // behoben; ohne ihn sucht jemand eine Stunde.
      return {
        ok: false,
        reason:
          'Google hat kein dauerhaftes Zugriffsrecht geschickt. In den Google-Kontoeinstellungen unter „Drittanbieter-Zugriff" den Zugriff dieser App entfernen und noch einmal verbinden.',
      };
    }
    if (!token.access_token) return { ok: false, reason: 'Google hat kein Zugriffstoken geliefert.' };

    const info = await fetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!info.ok) return { ok: false, reason: 'Die Adresse des Postfachs war bei Google nicht lesbar.' };
    const profile = (await info.json()) as { email?: string };
    if (!profile.email) return { ok: false, reason: 'Google hat keine E-Mail-Adresse geliefert.' };

    return {
      ok: true,
      grant: { email: profile.email.trim().toLowerCase(), refreshToken: token.refresh_token },
    };
  } catch {
    return { ok: false, reason: 'Google war nicht erreichbar.' };
  }
}

/**
 * Holt ein frisches Zugriffstoken für ein verbundenes Postfach.
 *
 * `needsReconnect` unterscheidet zwei Fälle, die auf dem Bildschirm völlig
 * verschieden aussehen müssen: „Google war gerade nicht erreichbar" (wartet
 * sich aus) und „die Zustimmung wurde widerrufen" (jemand muss den Knopf
 * drücken). Ein gemeinsames „Fehler" für beides führt dazu, dass das eine
 * ignoriert und das andere übersehen wird.
 */
export async function freshAccessToken(args: {
  config: MailboxOAuthConfig;
  refreshToken: string;
}): Promise<{ ok: true; accessToken: string } | { ok: false; reason: string; needsReconnect: boolean }> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: args.refreshToken,
        client_id: args.config.clientId,
        client_secret: args.config.clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    if (res.status >= 400 && res.status < 500) {
      return {
        ok: false,
        reason: 'Google hat den Zugriff zurückgezogen — das Postfach muss neu verbunden werden.',
        needsReconnect: true,
      };
    }
    if (!res.ok) {
      return { ok: false, reason: `Google antwortet mit ${res.status}.`, needsReconnect: false };
    }
    const token = (await res.json()) as { access_token?: string };
    if (!token.access_token) {
      return { ok: false, reason: 'Google hat kein Zugriffstoken geliefert.', needsReconnect: false };
    }
    return { ok: true, accessToken: token.access_token };
  } catch {
    return { ok: false, reason: 'Google war nicht erreichbar.', needsReconnect: false };
  }
}
