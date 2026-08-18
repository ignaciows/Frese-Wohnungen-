import { describe, expect, it } from 'vitest';
import { MAIN_SOURCE_KEYS, SEED_SOURCES, seedSource } from '@/domain/sources/catalog';

describe('source catalogue', () => {
  it('is exactly the three portals and nothing else', () => {
    expect(SEED_SOURCES.map((s) => s.key).sort()).toEqual([...MAIN_SOURCE_KEYS].sort());
  });

  it('has no duplicate keys', () => {
    const keys = SEED_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every source a working entry point', () => {
    for (const s of SEED_SOURCES) {
      expect(s.websiteUrl, s.key).toMatch(/^https:\/\//);
      expect(s.notes.length, s.key).toBeGreaterThan(20);
    }
  });

  it('only names an adapter for a source we can actually read', () => {
    // ImmoScout24 and Immowelt block automated reads. Declaring an adapter for
    // them would produce nothing but blocked runs in the log — the whole reason
    // they go through the e-mail Suchauftrag instead.
    for (const s of SEED_SOURCES) {
      if (s.route === 'EMAIL_ALERT') expect(s.discoveryAdapter, s.key).toBeUndefined();
      else expect(s.discoveryAdapter, s.key).toBeTruthy();
    }
  });

  it('tells a colleague how to set up the two e-mail portals', () => {
    for (const s of SEED_SOURCES.filter((x) => x.route === 'EMAIL_ALERT')) {
      expect(s.manualRecipe, s.key).toBeTruthy();
      expect(s.manualRecipe, s.key).toMatch(/such/i);
    }
  });

  it('gives every source enough mapping to generate a search recipe', () => {
    for (const s of SEED_SOURCES) {
      const filters = s.filters.map((f) => f.filter);
      expect(filters, s.key).toContain('location');
      expect(filters, s.key).toContain('maxWarmmiete');
    }
  });

  it('warns that the portals filter Kaltmiete while our budget is Warmmiete', () => {
    for (const s of SEED_SOURCES) {
      const rent = s.filters.find((f) => f.filter === 'maxWarmmiete');
      expect(rent?.quality, s.key).toBe('APPROXIMATE');
      expect(rent?.note, s.key).toMatch(/kaltmiete/i);
    }
  });

  it('looks a source up by key, and returns null for anything else', () => {
    expect(seedSource('kleinanzeigen')?.route).toBe('DISCOVERY');
    expect(seedSource('immowelt')?.route).toBe('EMAIL_ALERT');
    expect(seedSource('wg-gesucht')).toBeNull();
  });
});
