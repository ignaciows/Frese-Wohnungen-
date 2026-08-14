/**
 * The accounts the team holds on housing portals, plus the shared mailbox that
 * Anfragen are sent from and replies arrive in.
 *
 * The one invariant this module exists to enforce: **a secret goes in and
 * never comes back out.** Every read path returns `hasSecret: boolean` instead
 * of the value. Decryption happens in exactly two places — sending mail and
 * reading the mailbox — and both are server-only.
 */

import { prisma } from '@/lib/prisma';
import {
  credentialKeyConfigured,
  decryptSecret,
  encryptSecret,
  CredentialKeyMissingError,
} from '@/lib/crypto';
import { safeFetch } from '@/lib/safeFetch';

export interface PortalAccountView {
  id: string;
  kind: 'PORTAL' | 'MAILBOX';
  siteKey: string;
  sourceId: string | null;
  sourceName: string | null;
  label: string;
  loginName: string | null;
  /** Never the secret itself — only whether one is stored. */
  hasSecret: boolean;
  replyToAddress: string | null;
  meta: Record<string, unknown>;
  active: boolean;
  status: string;
  statusNote: string | null;
  lastVerifiedAt: Date | null;
}

export interface SaveAccountInput {
  id?: string;
  kind: 'PORTAL' | 'MAILBOX';
  siteKey: string;
  sourceId?: string | null;
  label: string;
  loginName?: string | null;
  /**
   * Undefined leaves an existing secret untouched — so editing a label does not
   * force the password to be retyped. An empty string clears it.
   */
  secret?: string;
  secondarySecret?: string;
  replyToAddress?: string | null;
  meta?: Record<string, unknown>;
  active?: boolean;
  userId: string;
}

function toView(row: {
  id: string;
  kind: string;
  siteKey: string;
  sourceId: string | null;
  label: string;
  loginName: string | null;
  secretEnc: string | null;
  replyToAddress: string | null;
  meta: unknown;
  active: boolean;
  status: string;
  statusNote: string | null;
  lastVerifiedAt: Date | null;
  source?: { name: string } | null;
}): PortalAccountView {
  return {
    id: row.id,
    kind: row.kind as 'PORTAL' | 'MAILBOX',
    siteKey: row.siteKey,
    sourceId: row.sourceId,
    sourceName: row.source?.name ?? null,
    label: row.label,
    loginName: row.loginName,
    hasSecret: !!row.secretEnc,
    replyToAddress: row.replyToAddress,
    meta: (row.meta as Record<string, unknown>) ?? {},
    active: row.active,
    status: row.status,
    statusNote: row.statusNote,
    lastVerifiedAt: row.lastVerifiedAt,
  };
}

export async function listAccounts(kind?: 'PORTAL' | 'MAILBOX'): Promise<PortalAccountView[]> {
  const rows = await prisma.portalAccount.findMany({
    where: kind ? { kind } : undefined,
    orderBy: [{ kind: 'asc' }, { label: 'asc' }],
    include: { source: { select: { name: true } } },
  });
  return rows.map(toView);
}

export async function saveAccount(
  input: SaveAccountInput,
): Promise<{ ok: true; account: PortalAccountView } | { ok: false; reason: string }> {
  const label = input.label.trim();
  const siteKey = input.siteKey.trim();
  if (!label) return { ok: false, reason: 'Bitte einen Namen für den Zugang angeben.' };
  if (!siteKey) return { ok: false, reason: 'Bitte die Website bzw. Quelle angeben.' };

  // Refuse rather than store a password in the clear.
  const wantsSecret = (input.secret ?? '').length > 0 || (input.secondarySecret ?? '').length > 0;
  if (wantsSecret && !credentialKeyConfigured()) {
    return {
      ok: false,
      reason:
        'CREDENTIAL_KEY ist nicht gesetzt — ohne diesen Schlüssel werden keine Passwörter gespeichert. Bitte in der Serverkonfiguration hinterlegen (32+ Zeichen).',
    };
  }

  let secretEnc: string | null | undefined;
  let secondarySecretEnc: string | null | undefined;
  try {
    // undefined = leave as is, '' = clear, otherwise = replace.
    if (input.secret !== undefined) secretEnc = input.secret ? encryptSecret(input.secret) : null;
    if (input.secondarySecret !== undefined) {
      secondarySecretEnc = input.secondarySecret ? encryptSecret(input.secondarySecret) : null;
    }
  } catch (err) {
    if (err instanceof CredentialKeyMissingError) return { ok: false, reason: err.message };
    throw err;
  }

  const data = {
    kind: input.kind,
    siteKey,
    sourceId: input.sourceId ?? null,
    label,
    loginName: input.loginName?.trim() || null,
    replyToAddress: input.replyToAddress?.trim() || null,
    meta: (input.meta ?? {}) as never,
    active: input.active ?? true,
    ...(secretEnc !== undefined ? { secretEnc } : {}),
    ...(secondarySecretEnc !== undefined ? { secondarySecretEnc } : {}),
    // Any change invalidates a previous verification.
    ...(secretEnc !== undefined || secondarySecretEnc !== undefined
      ? { status: 'UNVERIFIED', statusNote: null, lastVerifiedAt: null }
      : {}),
  };

  const row = input.id
    ? await prisma.portalAccount.update({
        where: { id: input.id },
        data,
        include: { source: { select: { name: true } } },
      })
    : await prisma.portalAccount.create({
        data: { ...data, createdById: input.userId },
        include: { source: { select: { name: true } } },
      });

  await prisma.auditEvent.create({
    data: {
      userId: input.userId,
      entityType: 'PortalAccount',
      entityId: row.id,
      action: input.id ? 'account.update' : 'account.create',
      // The label is safe to record; the credential never is.
      meta: { siteKey, label, secretChanged: secretEnc !== undefined } as never,
    },
  });

  return { ok: true, account: toView(row) };
}

export async function deleteAccount(id: string, userId: string): Promise<void> {
  await prisma.portalAccount.delete({ where: { id } });
  await prisma.auditEvent.create({
    data: { userId, entityType: 'PortalAccount', entityId: id, action: 'account.delete' },
  });
}

/* ------------------------------------------------------------- mailbox --- */

export interface MailboxCredentials {
  accountId: string;
  label: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  user: string;
  password: string;
  /** Separate IMAP password, when the provider needs one. */
  imapPassword: string;
}

/**
 * Loads and decrypts the shared mailbox. Server-only, and the only path that
 * ever turns a stored secret back into a usable string.
 *
 * Returns a reason rather than throwing, because "the mailbox is not set up
 * yet" is a normal state the UI has to explain, not an exception.
 */
export async function loadMailbox(
  accountId?: string,
): Promise<{ ok: true; credentials: MailboxCredentials } | { ok: false; reason: string }> {
  // Without an id: the oldest active mailbox, which is what a single-mailbox
  // setup has always meant. With one: that specific mailbox, so several can be
  // read and verified independently.
  const account = accountId
    ? await prisma.portalAccount.findFirst({ where: { id: accountId, kind: 'MAILBOX' } })
    : await prisma.portalAccount.findFirst({
        where: { kind: 'MAILBOX', active: true },
        orderBy: { createdAt: 'asc' },
      });
  if (!account) {
    return {
      ok: false,
      reason: 'Kein Postfach eingerichtet. In den Einstellungen unter „Konten & Postfach" hinterlegen.',
    };
  }
  if (!account.secretEnc) {
    return { ok: false, reason: `Für „${account.label}" ist kein Passwort hinterlegt.` };
  }

  const meta = (account.meta as Record<string, unknown>) ?? {};
  const smtpHost = str(meta.smtpHost);
  if (!smtpHost) {
    return { ok: false, reason: `Für „${account.label}" fehlt der SMTP-Server.` };
  }
  // Most providers use the same hostname for both; asking twice would be noise.
  const imapHost = str(meta.imapHost) ?? smtpHost;
  if (!account.loginName) {
    return { ok: false, reason: `Für „${account.label}" fehlt der Benutzername.` };
  }

  let password: string;
  let imapPassword: string;
  try {
    password = decryptSecret(account.secretEnc);
    imapPassword = account.secondarySecretEnc ? decryptSecret(account.secondarySecretEnc) : password;
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  const smtpPort = num(meta.smtpPort) ?? 587;
  const imapPort = num(meta.imapPort) ?? 993;

  return {
    ok: true,
    credentials: {
      accountId: account.id,
      label: account.label,
      smtpHost,
      smtpPort,
      // Port 465 is implicit TLS; 587 and 25 upgrade with STARTTLS.
      smtpSecure: meta.smtpSecure === true || smtpPort === 465,
      imapHost,
      imapPort,
      imapSecure: meta.imapSecure !== false,
      user: account.loginName,
      password,
      imapPassword,
    },
  };
}

/**
 * Every mailbox the app is allowed to read, oldest first.
 *
 * More than one is the normal case: the Suchauftrag mailbox, the shared inbox
 * the team works in Front, and a test account while somebody is setting the
 * next one up. Each is loaded, verified and read on its own, so a broken
 * password on one never silences the others.
 */
export async function listMailboxes(): Promise<Array<{ id: string; label: string }>> {
  const rows = await prisma.portalAccount.findMany({
    where: { kind: 'MAILBOX', active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, label: true },
  });
  return rows;
}

export async function markAccountStatus(
  id: string,
  status: 'OK' | 'FAILED',
  note: string | null,
): Promise<void> {
  await prisma.portalAccount.update({
    where: { id },
    data: { status, statusNote: note, lastVerifiedAt: status === 'OK' ? new Date() : null },
  });
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * Checks a stored portal login, without logging in.
 *
 * Logging in on a colleague's behalf is not on the table: every one of these
 * portals forbids automated access in its terms, and the account that would be
 * banned for it is the company's own — the same account the recruiters need to
 * write enquiries from. So this checks the two things that genuinely break and
 * that nobody can see from the outside.
 *
 * The one that actually happens is the second: `CREDENTIAL_KEY` gets rotated or
 * restored from a different environment, and every stored password silently
 * becomes unreadable. Nothing announces that. The morning somebody sits down to
 * send fifteen enquiries, the vault is simply empty, and the only clue is that
 * sending fails one flat at a time.
 */
export async function verifyPortalAccount(
  id: string,
): Promise<{ ok: boolean; status: 'OK' | 'FAILED'; message: string }> {
  const account = await prisma.portalAccount.findUnique({ where: { id } });
  if (!account) return { ok: false, status: 'FAILED', message: 'Zugang nicht gefunden.' };

  if (!account.secretEnc) {
    const message = 'Kein Passwort hinterlegt — bitte eintragen.';
    await markAccountStatus(id, 'FAILED', message);
    return { ok: false, status: 'FAILED', message };
  }

  try {
    decryptSecret(account.secretEnc);
  } catch {
    const message =
      'Das gespeicherte Passwort lässt sich nicht mehr entschlüsseln — bitte neu eintragen.';
    await markAccountStatus(id, 'FAILED', message);
    return { ok: false, status: 'FAILED', message };
  }

  const reach = await reachable(account.meta as Record<string, unknown> | null, account.siteKey);
  if (!reach.ok) {
    await markAccountStatus(id, 'FAILED', reach.message);
    return { ok: false, status: 'FAILED', message: reach.message };
  }

  const message = `Passwort lesbar, ${reach.message} Anmelden müssen Sie sich weiterhin selbst — das schreiben die Portale so vor.`;
  await markAccountStatus(id, 'OK', message);
  return { ok: true, status: 'OK', message };
}

/** Is the portal answering at all? Says nothing about the credentials. */
async function reachable(
  meta: Record<string, unknown> | null,
  siteKey: string,
): Promise<{ ok: boolean; message: string }> {
  const raw = typeof meta?.profileUrl === 'string' ? meta.profileUrl.trim() : '';
  if (!raw) return { ok: true, message: `Portal „${siteKey}" nicht geprüft (keine Login-Adresse hinterlegt).` };

  const res = await safeFetch(raw);
  if (res.networkError) {
    return { ok: false, message: `Login-Seite nicht erreichbar: ${res.networkError.slice(0, 120)}` };
  }
  // Any answer at all means the address is real. A login page that returns 401,
  // or redirects to one, is the normal healthy case — not a fault.
  return { ok: true, message: `Login-Seite erreichbar (HTTP ${res.status}).` };
}
