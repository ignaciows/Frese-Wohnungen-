/**
 * The gate that keeps a landlord's navigation out of the flat list.
 *
 * The examples marked "live" are the actual titles a real sweep of Gewobag
 * returned through the link-list adapter, which is what prompted this gate.
 */

import { describe, expect, it } from 'vitest';
import { isPlausibleHousing } from '@/domain/discovery/plausible';

const accept = (input: Parameters<typeof isPlausibleHousing>[0]) => isPlausibleHousing(input).plausible;

describe('plausibility gate', () => {
  it('accepts an ordinary flat', () => {
    expect(accept({ title: '3-Zimmer-Wohnung mit Balkon in Heilbronn' })).toBe(true);
    expect(accept({ title: 'Helles Apartment am Neckar' })).toBe(true);
    expect(accept({ title: 'WG-Zimmer in Heilbronn Ost' })).toBe(true);
  });

  it('accepts anything the result list gave a number for', () => {
    // A room count or a rent is the strongest signal there is: navigation
    // never comes with one.
    expect(accept({ title: 'Objekt 4711', structured: { rooms: 2 } })).toBe(true);
    expect(accept({ title: 'Objekt 4711', structured: { kaltMieteCents: 78000 } })).toBe(true);
    expect(accept({ title: 'Objekt 4711', structured: { livingSpaceSqm: 62 } })).toBe(true);
  });

  it('rejects the navigation a link-list adapter drags in (live examples)', () => {
    for (const title of [
      'Immobilien Archiv - Gewobag',
      'Lagerraum in Berlin mieten - Gewobag',
      'Ihr E-Stellplatz im Quartier - Gewobag',
      'Gewerberäume für Ihre Geschäftsidee finden - Gewobag',
      'Gewerbeangebote finden',
    ]) {
      expect(isPlausibleHousing({ title }).plausible, title).toBe(false);
    }
  });

  it('rejects a menu entry built from the same words an advert uses (live examples)', () => {
    // These two survived the first version of the gate and reached the pool:
    // both contain "Wohnung"/"wohnen", so the wording check waved them past,
    // and only the failed detail read eventually removed them.
    for (const title of [
      'Wohnungsangebote finden',
      'Wohnen im Alter in Berlin - Gewobag',
      'Alle Wohnungen im Überblick',
      'Zurück zur Suche',
      'Betreutes Wohnen',
      'Wohnungssuche',
    ]) {
      expect(isPlausibleHousing({ title }).plausible, title).toBe(false);
    }
  });

  it('never rejects an advert on wording when it came with a figure', () => {
    // The measurement shortcut runs first on purpose. A real advert titled in
    // a menu-ish way must still get through — a missed flat costs more than a
    // stray row, and the figure proves it is an advert.
    expect(accept({ title: 'Wohnen im Alter in Berlin', structured: { rooms: 2 } })).toBe(true);
    expect(accept({ title: 'Wohnungsangebote finden', structured: { kaltMieteCents: 65000 } })).toBe(true);
  });

  it('rejects other things that are let but are not homes', () => {
    for (const title of ['Tiefgaragenplatz zu vermieten', 'Bürofläche 120 m²', 'Ladenlokal in der Innenstadt', 'Grundstück am Waldrand']) {
      expect(isPlausibleHousing({ title }).plausible, title).toBe(false);
    }
  });

  it('does not reject a flat that merely mentions a parking space', () => {
    // The exclusions are matched against the title, where they describe the
    // whole advert — not the body, where they are a feature.
    expect(
      accept({
        title: '2-Zimmer-Wohnung in Heilbronn',
        description: 'Stellplatz inklusive, Garage gegen Aufpreis.',
      }),
    ).toBe(true);
  });

  it('rejects an untitled link with nothing else to go on', () => {
    expect(accept({ title: 'Anzeige (Titel folgt bei Detailprüfung)', description: '' })).toBe(false);
  });

  it('follows an untitled link when the body talks about a flat', () => {
    expect(
      accept({
        title: 'Anzeige (Titel folgt bei Detailprüfung)',
        description: 'Schöne 2-Zimmer-Wohnung im Erdgeschoss, frei ab Oktober, Nähe Innenstadt.',
      }),
    ).toBe(true);
  });

  it('gives a reason, so the discovery log can explain itself', () => {
    expect(isPlausibleHousing({ title: 'Lagerraum mieten' }).reason).toMatch(/Kein Wohnraum/);
    expect(isPlausibleHousing({ title: 'Newsletter abonnieren' }).reason).toMatch(/Kein Wohnraum/);
    expect(isPlausibleHousing({ title: 'Etwas ganz anderes' }).reason).toMatch(/Zimmer/);
  });

  it('rejects an empty title', () => {
    expect(accept({ title: '' })).toBe(false);
  });
});

describe('listing URLs as a signal', () => {
  it('follows a structural advert URL even when the anchor had no text', () => {
    // A live Immowelt run produced 31 such links: the advert link wraps a
    // photo, so there is nothing to read until the detail page is fetched.
    expect(
      accept({
        title: 'Anzeige (Titel folgt bei Detailprüfung)',
        url: 'https://www.immowelt.de/expose/2abc3def',
      }),
    ).toBe(true);
  });

  it('still rejects a non-home even on a listing URL', () => {
    // The title is explicit; the path cannot override it.
    expect(
      accept({ title: 'Lagerraum in Berlin mieten - Gewobag', url: 'https://www.gewobag.de/mietangebote/12345' }),
    ).toBe(false);
  });

  it('does not treat an ordinary page URL as a signal', () => {
    expect(accept({ title: 'Anzeige (Titel folgt bei Detailprüfung)', url: 'https://x.de/ueber-uns' })).toBe(false);
  });
});
