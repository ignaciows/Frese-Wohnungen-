/**
 * The guard against a source answering about the wrong town.
 *
 * The numbers in the first test are the live incident: a sweep asked
 * Kleinanzeigen for Cologne (50937) while the source carried Heilbronn's
 * internal number, and 103 Heilbronn adverts — lamps, car parts and dining
 * chairs among them, because the mismatched slug also lost the category —
 * entered the pool under a run recorded as OK.
 */

import { describe, expect, it } from 'vitest';
import { checkBatchLocation } from '@/domain/discovery/locationSanity';

/** n adverts in one postal zone, spread over a few adjacent codes. */
const batch = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i % 9)}`.slice(0, 5));

describe('did the source answer about the town we asked for', () => {
  it('rejects a batch that is entirely in another corner of the country', () => {
    const result = checkBatchLocation('50937', batch('7407', 20));

    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/andere Stadt|passt nicht/);
    // Must name both sides, or the log cannot be acted on.
    expect(result.note).toContain('74');
  });

  it('accepts a batch from the town that was asked for', () => {
    expect(checkBatchLocation('50937', batch('5093', 20)).ok).toBe(true);
  });

  it('accepts a commutable neighbouring region', () => {
    // Heilbronn is 74, Stuttgart 70: a real search around one reaches the
    // other, and rejecting that would throw away the commutable ring the
    // search exists to cover. Only the leading digit is compared.
    expect(checkBatchLocation('74072', batch('7011', 20)).ok).toBe(true);
  });

  it('tolerates a few strays in an otherwise correct batch', () => {
    const mostlyRight = [...batch('5093', 18), '74072', '80331'];
    expect(checkBatchLocation('50937', mostlyRight).ok).toBe(true);
  });

  it('says nothing when there is too little to judge', () => {
    // On a handful of adverts a wrong town and an unusual one look the same,
    // and a guard that guesses is worse than one that abstains.
    const result = checkBatchLocation('50937', batch('7407', 3));
    expect(result.ok).toBe(true);
    expect(result.note).toBeNull();
  });

  it('says nothing when the search carried no postcode', () => {
    expect(checkBatchLocation(null, batch('7407', 20)).ok).toBe(true);
    expect(checkBatchLocation('', batch('7407', 20)).note).toBeNull();
  });

  it('ignores adverts that carry no usable postcode', () => {
    const noCodes = [null, undefined, '', 'Köln', '1234'];
    expect(checkBatchLocation('50937', noCodes).ok).toBe(true);
  });
});
