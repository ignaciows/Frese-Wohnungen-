import { describe, expect, it } from 'vitest';
import { SEED_SOURCES } from '@/domain/sources/catalog';

describe('source catalogue', () => {
  it('has no duplicate keys', () => {
    const keys = SEED_SOURCES.map((s) => s.key);
    const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
    expect(dupes).toEqual([]);
  });

  it('has no empty slots', () => {
    expect(SEED_SOURCES.every((s) => s != null)).toBe(true);
  });

  it('covers a broad set of sources', () => {
    expect(SEED_SOURCES.length).toBeGreaterThanOrEqual(40);
  });

  it('never claims automated ingestion in the seed', () => {
    // Enabling automation is an explicit admin decision after a terms review,
    // never something the shipped catalogue asserts.
    const automated = SEED_SOURCES.filter(
      (s) => s.integrationMode === 'OFFICIAL_API' || s.integrationMode === 'EMAIL_ALERT',
    );
    expect(automated).toEqual([]);
  });

  it('gives every source a usable entry point and coverage', () => {
    for (const s of SEED_SOURCES) {
      expect(s.websiteUrl, s.key).toMatch(/^https?:\/\//);
      expect(s.coverage.length, s.key).toBeGreaterThan(0);
      expect(s.housingTypes.length, s.key).toBeGreaterThan(0);
    }
  });

  it('gives every source enough mapping to generate a search recipe', () => {
    // manualRecipe is an optional extra hint; the recipe a colleague reads is
    // generated from the filter mappings, so those are what must exist.
    for (const s of SEED_SOURCES) {
      expect(s.filterMappings.length, s.key).toBeGreaterThan(0);
      const filters = s.filterMappings.map((f) => f.canonicalFilter);
      expect(filters, s.key).toContain('location');
      expect(filters, s.key).toContain('maxWarmmiete');
    }
  });

  it('every declared mapping quality is a known value', () => {
    const valid = new Set(['EXACT', 'APPROXIMATE', 'MANUAL', 'UNSUPPORTED', 'UNKNOWN']);
    for (const s of SEED_SOURCES) {
      for (const f of s.filterMappings) {
        expect(valid.has(f.quality), `${s.key}/${f.canonicalFilter}`).toBe(true);
      }
    }
  });
});
