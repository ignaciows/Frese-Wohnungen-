/**
 * Schritt 1: zu Google schicken.
 *
 * Der `state` ist der Schutz gegen CSRF: ein Zufallswert, der gleichzeitig in
 * ein kurzlebiges httpOnly-Cookie und in die URL geht. Kommt der Nutzer zurück
 * und stimmen die beiden nicht überein, hat jemand anderes den Rücksprung
 * ausgelöst und wir brechen ab.
 */

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { authorizeUrl, googleConfig, STATE_COOKIE } from '@/lib/googleAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const config = googleConfig();
  // Nicht eingerichtet heißt: den Weg gibt es nicht.
  if (!config) notFound();

  const state = crypto.randomUUID();
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SESSION_SECURE_COOKIE === 'true',
    path: '/',
    // Lang genug für eine Anmeldung samt Zwei-Faktor, kurz genug, um nicht
    // tagelang gültig zu bleiben.
    maxAge: 600,
  });

  redirect(authorizeUrl({ config, requestUrl: request.url, state }));
}
