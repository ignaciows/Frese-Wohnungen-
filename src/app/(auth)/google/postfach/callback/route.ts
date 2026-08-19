/**
 * Schritt 2: Google kommt mit einem Code zurück, wir machen daraus ein
 * verbundenes Postfach.
 *
 * Gespeichert wird nur der Refresh-Token, verschlüsselt wie jedes andere
 * Geheimnis. Die Serverdaten kommen aus einer Konstante — niemand soll
 * „imap.gmail.com" abtippen müssen, und niemand soll es falsch abtippen
 * können.
 *
 * Ein bereits verbundenes Postfach derselben Adresse wird aktualisiert und
 * nicht verdoppelt: „nochmal verbinden" ist genau das, was jemand tut, wenn
 * der Zugriff abgelaufen ist, und danach zwei Einträge derselben Adresse
 * dastehen zu haben wäre die schlechteste Antwort darauf.
 */

import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { currentUser } from '@/lib/auth';
import {
  GMAIL_HOSTS,
  MAILBOX_STATE_COOKIE,
  exchangeCodeForMailbox,
  mailboxOAuthConfig,
} from '@/lib/googleMailbox';
import { saveAccount } from '@/server/portalAccounts';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Zurück zu den Einstellungen, mit einem Kürzel für die Rückmeldung.
 *  `never`, weil `redirect` wirft — so weiß TypeScript, dass es hier endet. */
const back: (params: string) => never = (params) => redirect(`/einstellungen?${params}#konten`);

export async function GET(request: Request) {
  const config = mailboxOAuthConfig();
  if (!config) notFound();

  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'ADMIN') notFound();

  const url = new URL(request.url);
  const store = await cookies();
  const expected = store.get(MAILBOX_STATE_COOKIE)?.value;
  store.delete(MAILBOX_STATE_COOKIE);

  if (url.searchParams.get('error')) back('fehler=google-postfach-abgebrochen');
  if (!expected || url.searchParams.get('state') !== expected) {
    back('fehler=google-postfach-abgelaufen');
  }

  const code = url.searchParams.get('code');
  if (!code) back('fehler=google-postfach-abgebrochen');

  const result = await exchangeCodeForMailbox({ config, code, requestUrl: request.url });
  if (!result.ok) {
    // Der genaue Grund steht im Serverprotokoll. Auf dem Bildschirm steht ein
    // Satz, mit dem jemand etwas anfangen kann.
    console.warn(`[google-postfach] ${result.reason}`);
    back('fehler=google-postfach-fehlgeschlagen');
  }
  const { grant } = result;

  // Dieselbe Adresse noch einmal verbunden: derselbe Eintrag, neuer Token.
  const existing = await prisma.portalAccount.findFirst({
    where: { kind: 'MAILBOX', loginName: grant.email },
    select: { id: true, label: true },
  });

  const saved = await saveAccount({
    id: existing?.id,
    kind: 'MAILBOX',
    siteKey: 'google',
    label: existing?.label ?? grant.email,
    loginName: grant.email,
    secret: grant.refreshToken,
    replyToAddress: grant.email,
    meta: { ...GMAIL_HOSTS, authMethod: 'GOOGLE_OAUTH' },
    active: true,
    userId: user.id,
  });

  if (!saved.ok) {
    console.warn(`[google-postfach] ${saved.reason}`);
    back('fehler=google-postfach-speichern');
  }

  // Sofort einmal wirklich anmelden. Ein grünes Lämpchen, das nur „Google hat
  // zugestimmt" bedeutet, ist die Art Auskunft, wegen der niemand nachsieht,
  // warum nichts hereinkommt.
  const { verifyMailbox } = await import('@/server/outbound');
  const check = await verifyMailbox(saved.account.id);

  back(check.ok ? 'gespeichert=google-postfach' : 'fehler=google-postfach-pruefung');
}
