/**
 * Two things decide whether a colleague wastes an afternoon: how old an ad
 * really is, and whether the town number actually points at the right town.
 * Both fail quietly when they fail, which is why they are tested here.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGE_FILTER,
  describeAgeFilter,
  listingAge,
  passesAgeFilter,
} from '@/domain/timing/age';
import {
  citySlug,
  extractLocationLinks,
  resolveCityId,
  verifyLocation,
} from '@/domain/discovery/adapters/kleinanzeigenLocations';

const NOW = new Date('2026-08-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('how old is this ad, really', () => {
  it('prefers the date the portal printed', () => {
    const age = listingAge(
      { postedAt: daysAgo(3), firstSeenAt: daysAgo(1), importedAt: daysAgo(1) },
      NOW,
    );
    expect(age.source).toBe('PORTAL');
    expect(age.ageDays).toBe(3);
    expect(age.approximate).toBe(false);
  });

  it('falls back to the alert, which lands within hours of publication', () => {
    const age = listingAge(
      { postedAt: null, alertedAt: daysAgo(2), firstSeenAt: daysAgo(2), importedAt: NOW },
      NOW,
    );
    expect(age.source).toBe('ALERT');
    expect(age.ageDays).toBe(2);
  });

  it('marks our own import date as approximate and says so in the label', () => {
    // The whole point: an ad we found today may have been up for weeks, and
    // the badge must not claim otherwise.
    const age = listingAge({ postedAt: null, firstSeenAt: null, importedAt: daysAgo(1) }, NOW);
    expect(age.source).toBe('FIRST_SEEN');
    expect(age.approximate).toBe(true);
    expect(age.label).toContain('bekannt');
  });
});

describe('the maximum-age filter', () => {
  const strict = { maxAgeDays: 7, hideApproximate: false };

  it('is off by default, so nobody loses a list without asking', () => {
    expect(DEFAULT_AGE_FILTER.maxAgeDays).toBe(0);
    const old = listingAge({ postedAt: daysAgo(90), firstSeenAt: null, importedAt: NOW }, NOW);
    expect(passesAgeFilter(old, DEFAULT_AGE_FILTER)).toBe(true);
  });

  it('hides an ad the portal says is older than the limit', () => {
    const old = listingAge({ postedAt: daysAgo(30), firstSeenAt: null, importedAt: NOW }, NOW);
    expect(passesAgeFilter(old, strict)).toBe(false);
  });

  it('keeps one inside the limit', () => {
    const fresh = listingAge({ postedAt: daysAgo(2), firstSeenAt: null, importedAt: NOW }, NOW);
    expect(passesAgeFilter(fresh, strict)).toBe(true);
  });

  it('keeps ads with no portal date rather than emptying the list', () => {
    // Portals that never print a date would otherwise vanish entirely, and an
    // empty list reads as "no flats" instead of "we cannot tell".
    const unknown = listingAge({ postedAt: null, firstSeenAt: daysAgo(60), importedAt: NOW }, NOW);
    expect(passesAgeFilter(unknown, strict)).toBe(true);
  });

  it('drops them too when the admin asks for exactly that', () => {
    const unknown = listingAge({ postedAt: null, firstSeenAt: daysAgo(60), importedAt: NOW }, NOW);
    expect(passesAgeFilter(unknown, { maxAgeDays: 7, hideApproximate: true })).toBe(false);
  });

  it('explains an emptied list instead of implying the market is empty', () => {
    const ages = [
      listingAge({ postedAt: daysAgo(30), firstSeenAt: null, importedAt: NOW }, NOW),
      listingAge({ postedAt: null, firstSeenAt: daysAgo(30), importedAt: NOW }, NOW),
    ];
    const note = describeAgeFilter(ages, strict);
    expect(note).toContain('ausgeblendet');
    expect(note).toContain('ohne Portal-Datum');
    expect(describeAgeFilter(ages, DEFAULT_AGE_FILTER)).toBeNull();
  });
});

describe('resolving the Kleinanzeigen town number', () => {
  const ROOT = `
    <a href="/s-wohnung-mieten/baden-wuerttemberg/c203l7970">BW</a>
    <a href="/s-wohnung-mieten/berlin/c203l3331">Berlin</a>
    <a href="/s-wohnung-mieten/deutschland/c203l0">Alle</a>`;
  const BW = `<a href="/s-wohnung-mieten/heilbronn/c203l9228">Heilbronn</a>`;

  const fetcher = (map: Record<string, string>) => async (url: string) => {
    for (const [frag, body] of Object.entries(map)) if (url.includes(frag)) return body;
    return null;
  };

  it('reads the ids the portal publishes in its own navigation', () => {
    const links = extractLocationLinks(ROOT);
    expect(links).toContainEqual({ id: '3331', slug: 'berlin' });
    // "0" means all of Germany — accepting it would undo the whole search.
    expect(links.some((l) => l.id === '0')).toBe(false);
  });

  it('finds a city-state in the first hop', async () => {
    const r = await resolveCityId('Berlin', fetcher({ '/c203': ROOT }));
    expect(r.id).toBe('3331');
  });

  it('walks into the federal state for an ordinary town', async () => {
    const r = await resolveCityId(
      'Heilbronn',
      fetcher({ 'c203l7970': BW, '/s-wohnung-mieten/c203': ROOT }),
    );
    expect(r.id).toBe('9228');
  });

  it('says so rather than guessing when the town is not listed', async () => {
    const r = await resolveCityId('Kleinkleckersdorf', fetcher({ '/s-wohnung-mieten/c203': ROOT }));
    expect(r.id).toBeNull();
    expect(r.note).toContain('nicht gefunden');
  });

  it('handles umlauts in the slug', () => {
    expect(citySlug('München')).toBe('muenchen');
    expect(citySlug('Frankfurt am Main')).toBe('frankfurt-am-main');
  });
});

describe('catching the nationwide fallback', () => {
  // Shapes taken from the live payloads — a full result page, because that is
  // the sample size the check actually runs on.
  const berlin = {
    places: ['Neukölln', 'Friedenau', 'Schöneberg', 'Kreuzberg', 'Zehlendorf', 'Tiergarten', 'Mitte', 'Wedding', 'Pankow', 'Steglitz', 'Moabit', 'Lichtenberg'],
    codes: ['12043', '12159', '10781', '10967', '14163', '10785', '10115', '13353', '13187', '12163', '10555', '10315'],
  };
  const nationwide = {
    places: ['Olpe', 'Passau', 'Pegnitz', 'Plauen', 'Gera', 'Chemnitz', 'Marienberg', 'Freiburg', 'Oldenburg', 'Neusäß', 'St Arnual', 'Bielefeld'],
    codes: ['57462', '94032', '91257', '08523', '07545', '09120', '09496', '79104', '26123', '86356', '66119', '33602'],
  };

  it('accepts a real city search even when only districts are named', () => {
    // Berlin never returns the word "Berlin" — this is the case that made a
    // name-only check useless.
    expect(verifyLocation('Berlin', berlin.places, berlin.codes).ok).toBe(true);
  });

  it('rejects the nationwide list, which is what a missing number produces', () => {
    const v = verifyLocation('Heilbronn', nationwide.places, nationwide.codes);
    expect(v.ok).toBe(false);
    expect(v.note).toContain('bundesweite Liste');
  });

  it('accepts on a direct name match without needing postcodes', () => {
    expect(verifyLocation('Heilbronn', ['Heilbronn', 'Heilbronn'], []).ok).toBe(true);
  });

  it('does not pretend to judge on too little data', () => {
    expect(verifyLocation('Heilbronn', ['Irgendwo'], []).ok).toBe(true);
    // A handful of scattered ads is genuinely ambiguous — a big city looks the
    // same as the nationwide list at this sample size, so it must not accuse.
    const v = verifyLocation('Heilbronn', nationwide.places.slice(0, 5), nationwide.codes.slice(0, 5));
    expect(v.ok).toBe(true);
    expect(v.note).toContain('Zu wenige Daten');
  });
});
