/**
 * Schritt 2: zurück von Google.
 *
 * Hier wird entschieden, wer hereindarf. Die Reihenfolge der Prüfungen ist
 * Absicht — jede kann für sich alleine ablehnen:
 *
 *   state → Code eingelöst → E-Mail bestätigt → bekannt ODER erlaubte Domain
 *
 * Ein bestehendes Konto wird mit der Google-ID verknüpft und darf herein,
 * unabhängig von der Domain: wer schon angelegt ist, wurde von einem Menschen
 * angelegt. Ein *neues* Konto entsteht nur bei passender Domain und immer als
 * COLLEAGUE. Rollen vergibt ein Mensch, nicht ein Anmeldevorgang.
 */

import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { domainAllowed, exchangeCodeForIdentity, googleConfig, STATE_COOKIE } from '@/lib/googleAuth';
import { LOGIN_ERRORS } from '../../login/messages';

export const dynamic = 'force-dynamic';

/** Kürzel statt Klartext — die Anmeldeseite kennt die Sätze dazu. */
const fail = (code: keyof typeof LOGIN_ERRORS) => redirect(`/login?error=${code}`);

export async function GET(request: Request) {
  const config = googleConfig();
  if (!config) notFound();

  const url = new URL(request.url);
  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  // Einmal benutzt, weg damit — auch wenn gleich abgelehnt wird.
  store.delete(STATE_COOKIE);

  // Der Nutzer hat bei Google abgebrochen.
  if (url.searchParams.get('error')) fail('google-abgebrochen');

  const state = url.searchParams.get('state');
  if (!expectedState || !state || state !== expectedState) {
    fail('google-abgelaufen');
  }

  const code = url.searchParams.get('code');
  if (!code) fail('google-abgelaufen');

  const result = await exchangeCodeForIdentity({ config, code: code!, requestUrl: request.url });
  // Der genaue Grund steht im Serverprotokoll; auf dem Bildschirm nützt er
  // niemandem und verrät im Zweifel, ob es diese Adresse hier gibt.
  if (!result.ok) {
    console.warn(`[google] Anmeldung abgelehnt: ${result.reason}`);
    fail('google-fehlgeschlagen');
  }
  const identity = result.ok ? result.identity : null;
  if (!identity) fail('google-fehlgeschlagen');

  // Erst über die Google-ID suchen, dann über die E-Mail: die ID ist
  // unveränderlich, die Adresse nicht. Wer heiratet und umbenannt wird,
  // behält so sein Konto samt Verlauf.
  const byGoogleId = await prisma.user.findUnique({ where: { googleId: identity!.googleId } });
  const existing = byGoogleId ?? (await prisma.user.findUnique({ where: { email: identity!.email } }));

  let user = existing;

  if (user) {
    if (!user.active) fail('konto-deaktiviert');
    if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: identity!.googleId },
      });
    }
  } else {
    // Neu. Nur mit passender Domain, und nie als Admin.
    if (!domainAllowed(identity!.email, config)) {
      fail('kein-konto');
    }
    user = await prisma.user.create({
      data: {
        email: identity!.email,
        name: identity!.name,
        googleId: identity!.googleId,
        role: 'COLLEAGUE',
      },
    });
    await prisma.auditEvent.create({
      data: {
        userId: user.id,
        entityType: 'User',
        entityId: user.id,
        action: 'user.createdViaGoogle',
      },
    });
  }

  const session = await getSession();
  session.userId = user!.id;
  session.role = user!.role;
  session.name = user!.name;
  await session.save();

  redirect('/');
}
