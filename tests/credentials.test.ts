/**
 * The credential vault holds other people's portal passwords, so these tests
 * are mostly about what must *not* happen: no plaintext leaking through, no
 * tampered ciphertext decrypting, no silent weakening when the key is absent.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  encryptSecret,
  decryptSecret,
  credentialKeyConfigured,
  newThreadToken,
  tokensMatch,
  CredentialKeyMissingError,
  CredentialDecryptError,
} from '@/lib/crypto';
import { replyToWithToken, tokenFromAddress, fillSubject } from '@/server/outbound';

const KEY = 'test-credential-key-0123456789-abcdefghij';

/** Changes one base64url character at `index` to a definitely different one. */
function flipAt(value: string, index: number): string {
  const replacement = value[index] === 'A' ? 'B' : 'A';
  return value.slice(0, index) + replacement + value.slice(index + 1);
}

beforeEach(() => {
  process.env.CREDENTIAL_KEY = KEY;
});

describe('secret encryption', () => {
  it('round-trips a password', () => {
    const secret = 'hunter2-mit-Ümläuten-&-symbols!';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('never produces the same ciphertext twice', () => {
    // A deterministic ciphertext would reveal that two portals share a password.
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('never contains the plaintext', () => {
    expect(encryptSecret('sehr-geheim')).not.toContain('sehr-geheim');
  });

  it('rejects a tampered ciphertext instead of returning rubbish', () => {
    const parts = encryptSecret('original-secret-value').split('.');
    parts[3] = flipAt(parts[3], 2);
    expect(() => decryptSecret(parts.join('.'))).toThrow(CredentialDecryptError);
  });

  it('rejects a tampered authentication tag', () => {
    const parts = encryptSecret('original').split('.');
    // Flip a character in the middle: base64's final character carries padding
    // bits, so editing it can decode to the very same bytes.
    parts[2] = flipAt(parts[2], 4);
    expect(() => decryptSecret(parts.join('.'))).toThrow(CredentialDecryptError);
  });

  it('rejects malformed payloads', () => {
    for (const bad of ['', 'nonsense', 'v1.only.three', 'v2.a.b.c']) {
      expect(() => decryptSecret(bad)).toThrow(CredentialDecryptError);
    }
  });

  it('fails loudly rather than storing anything without a key', () => {
    delete process.env.CREDENTIAL_KEY;
    expect(credentialKeyConfigured()).toBe(false);
    expect(() => encryptSecret('x')).toThrow(CredentialKeyMissingError);
  });

  it('treats a too-short key as no key at all', () => {
    process.env.CREDENTIAL_KEY = 'short';
    expect(credentialKeyConfigured()).toBe(false);
    expect(() => encryptSecret('x')).toThrow(CredentialKeyMissingError);
  });

  it('cannot decrypt what a different key encrypted', () => {
    const payload = encryptSecret('geheim');
    process.env.CREDENTIAL_KEY = 'a-completely-different-key-0123456789';
    expect(() => decryptSecret(payload)).toThrow(CredentialDecryptError);
  });
});

describe('thread tokens', () => {
  it('are unique and URL-safe', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => newThreadToken()));
    expect(tokens.size).toBe(500);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('compare safely, including on length mismatch', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc123', 'abc124')).toBe(false);
    expect(tokensMatch('abc', 'abcdef')).toBe(false);
  });
});

describe('reply-to plus addressing', () => {
  it('embeds the token in the local part', () => {
    expect(replyToWithToken('wohnen@frese.de', 'ab12cd')).toBe('wohnen+ab12cd@frese.de');
  });

  it('replaces rather than stacks an existing tag', () => {
    expect(replyToWithToken('wohnen+alt@frese.de', 'neu123')).toBe('wohnen+neu123@frese.de');
  });

  it('leaves a malformed address alone', () => {
    expect(replyToWithToken('not-an-address', 'ab12cd')).toBe('not-an-address');
  });

  it('reads the token back out', () => {
    expect(tokenFromAddress('wohnen+ab12cd@frese.de')).toBe('ab12cd');
    expect(tokenFromAddress('Wohnen <wohnen+ab12cd@frese.de>')).toBe('ab12cd');
    // Plain plus-addressing a human chose is not one of our tokens.
    expect(tokenFromAddress('wohnen+abc@frese.de')).toBeNull();
    expect(tokenFromAddress('wohnen@frese.de')).toBeNull();
  });

  it('survives a full round trip', () => {
    const token = newThreadToken();
    expect(tokenFromAddress(replyToWithToken('post@firma.de', token))).toBe(token);
  });
});

describe('subject template', () => {
  it('substitutes the listing', () => {
    expect(fillSubject('Anfrage: {title} in {city}', { title: '2-Zi-Wohnung', locationCity: 'Heilbronn' })).toBe(
      'Anfrage: 2-Zi-Wohnung in Heilbronn',
    );
  });

  it('copes with a missing city', () => {
    expect(fillSubject('Anfrage: {title} {city}', { title: 'Wohnung', locationCity: null })).toBe('Anfrage: Wohnung');
  });
});
