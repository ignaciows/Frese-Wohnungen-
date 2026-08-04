import { describe, expect, it } from 'vitest';
import { extractSourceListingId, normaliseUrl } from '@/lib/url';

describe('normaliseUrl', () => {
  it('strips utm_* tracking parameters', () => {
    const u = normaliseUrl('https://www.example.com/list/1?utm_source=mail&utm_medium=x');
    expect(u).toBe('https://example.com/list/1');
  });

  it('drops fragments', () => {
    const u = normaliseUrl('https://example.com/list/1#section');
    expect(u).toBe('https://example.com/list/1');
  });

  it('normalises m. / mobile. host prefixes', () => {
    const a = normaliseUrl('https://m.example.com/list/1');
    const b = normaliseUrl('https://mobile.example.com/list/1');
    const c = normaliseUrl('https://example.com/list/1');
    expect(a).toBe(c);
    expect(b).toBe(c);
  });

  it('sorts remaining query parameters', () => {
    const u = normaliseUrl('https://example.com/?b=2&a=1');
    expect(u).toBe('https://example.com/?a=1&b=2');
  });

  it('leaves an unparseable URL alone', () => {
    const u = normaliseUrl('not a url');
    expect(u).toBe('not a url');
  });
});

describe('extractSourceListingId', () => {
  it('extracts ImmoScout24 expose id', () => {
    expect(extractSourceListingId('https://www.immobilienscout24.de/expose/153627384')).toBe('is24:153627384');
  });
  it('extracts Immowelt expose slug', () => {
    expect(extractSourceListingId('https://www.immowelt.de/expose/2abc-xyz')).toBe('immowelt:2abc-xyz');
  });
  it('extracts Kleinanzeigen numeric id from last path segment', () => {
    expect(
      extractSourceListingId('https://www.kleinanzeigen.de/s-anzeige/schoene-wohnung/1234567890'),
    ).toBe('kleinanzeigen:1234567890');
  });
  it('returns null when nothing recognisable is present', () => {
    expect(extractSourceListingId('https://example.com/list')).toBeNull();
  });
});
