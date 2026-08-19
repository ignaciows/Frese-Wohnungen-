/**
 * Schritt 1 beim Anbinden eines Google-Postfachs: zu Google schicken.
 *
 * Zwei Unterschiede zum Anmelde-Weg nebenan, beide wichtig:
 *
 *  - **Nur Admins.** Ein Postfach anzubinden heißt, der App dauerhaft Lese-
 *    und Sendezugriff darauf zu geben. Das ist keine Anmeldung, das ist eine
 *    Berechtigung für alle.
 *  - **`state` merkt sich, wohin es zurückgeht.** Sonst landet man nach dem
 *    Zustimmen auf der Startseite statt bei den Einstellungen.
 */

import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { currentUser } from '@/lib/auth';
import {
  MAILBOX_STATE_COOKIE,
  mailboxAuthorizeUrl,
  mailboxOAuthConfig,
} from '@/lib/googleMailbox';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const config = mailboxOAuthConfig();
  // Nicht eingerichtet heißt: den Weg gibt es nicht.
  if (!config) notFound();

  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'ADMIN') notFound();

  const state = crypto.randomUUID();
  const store = await cookies();
  store.set(MAILBOX_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SESSION_SECURE_COOKIE === 'true',
    path: '/',
    // Lang genug für Kontowahl und Zwei-Faktor, kurz genug, um nicht tagelang
    // gültig zu bleiben.
    maxAge: 600,
  });

  redirect(mailboxAuthorizeUrl({ config, requestUrl: request.url, state }));
}
