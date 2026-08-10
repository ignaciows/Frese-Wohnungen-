/**
 * Encryption for the portal credentials the team stores so that Anfragen can
 * be sent from inside the tool.
 *
 * Holding other people's passwords is a real responsibility, so the rules here
 * are strict:
 *
 *  - AES-256-GCM, which authenticates as well as encrypts: a tampered
 *    ciphertext fails to decrypt rather than yielding rubbish.
 *  - A fresh random IV per encryption, so encrypting the same password twice
 *    never produces the same ciphertext.
 *  - The key comes from `CREDENTIAL_KEY` in the environment, never from the
 *    database — a database dump on its own must not reveal a single password.
 *  - Nothing here logs a plaintext, and no decrypt helper is exported to the
 *    browser: secrets are only ever read server-side at the moment of sending.
 *
 * If `CREDENTIAL_KEY` is missing the app still runs; storing a credential is
 * refused with a clear message instead of falling back to something weaker.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = 'v1';

export class CredentialKeyMissingError extends Error {
  constructor() {
    super(
      'CREDENTIAL_KEY ist nicht gesetzt. Ohne diesen Schlüssel können keine Zugangsdaten gespeichert werden.',
    );
    this.name = 'CredentialKeyMissingError';
  }
}

export class CredentialDecryptError extends Error {
  constructor() {
    super(
      'Zugangsdaten konnten nicht entschlüsselt werden — vermutlich wurde CREDENTIAL_KEY geändert. Bitte neu eintragen.',
    );
    this.name = 'CredentialDecryptError';
  }
}

/**
 * Derives a 32-byte key from the configured secret.
 *
 * SHA-256 rather than a password KDF on purpose: this value is a
 * machine-generated secret from the deployment's secret manager, not a
 * human-chosen password, so there is no low-entropy guessing to slow down.
 * The documented way to produce it is `randomBytes(32)`.
 */
function keyFromEnv(): Buffer {
  const raw = process.env.CREDENTIAL_KEY?.trim();
  if (!raw || raw.length < 32) throw new CredentialKeyMissingError();
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function credentialKeyConfigured(): boolean {
  const raw = process.env.CREDENTIAL_KEY?.trim();
  return !!raw && raw.length >= 32;
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function encryptSecret(plaintext: string): string {
  const key = keyFromEnv();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const key = keyFromEnv();
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new CredentialDecryptError();

  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new CredentialDecryptError();

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // Includes the authentication-tag failure, which is the case that matters:
    // a modified ciphertext must never decrypt to anything usable.
    throw new CredentialDecryptError();
  }
}

/**
 * An unguessable token embedded in the reply-to address, so a landlord's answer
 * can be tied to the exact enquiry it belongs to.
 *
 * It travels through third-party mail servers in plain sight, so it is random
 * rather than derived — knowing one token must tell you nothing about another,
 * and it must not leak which candidate or flat it refers to.
 */
export function newThreadToken(): string {
  return randomBytes(9).toString('base64url');
}

/** Constant-time comparison for tokens arriving from outside. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
