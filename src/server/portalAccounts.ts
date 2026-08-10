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
export async function loadMailbox(): Promise<
  { ok: true; credentials: MailboxCredentials } | { ok: false; reason: string }
> {
  const account = await prisma.portalAccount.findFirst({
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
