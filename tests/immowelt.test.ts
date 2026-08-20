/**
 * Immowelt lesen.
 *
 * Gegen eine gespeicherte Seite, ohne Netz — wie bei jedem Adapter hier. Die
 * Vorlage ist ein Ausschnitt einer echten Trefferliste für Heilbronn.
 *
 * Der Adapter stützt sich bewusst auf zwei verschiedene Dinge: den `title` der
 * Karte (stabil, weil Suchmaschinen daran hängen) und ein paar
 * `data-testid`-Attribute (Immowelts eigene Testhaken, die sich ändern
 * können). Deshalb prüft die zweite Hälfte hier, dass ohne die Testhaken zwar
 * Angaben fehlen, aber keine Anzeige verlorengeht.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { immoweltAdapter, parseCardTitle } from '@/domain/discovery/adapters/immowelt';
import { DEFAULT_QUERY, type FetchedPage } from '@/domain/discovery/types';

const html = readFileSync(join(__dirname, 'fixtures', 'immowelt-suche.html'), 'utf8');

const page = (body: string | null): FetchedPage => ({
  url: 'https://www.immowelt.de/suche/mieten/wohnung/baden-wurttemberg/heilbronn-74072/ad08de5420',
  finalUrl: null,
  status: 200,
  body,
  error: null,
  blocked: false,
});

describe('Ort und Titel', () => {
  it('nimmt die Stadt aus der Adresszeile, nicht den Stadtteil aus dem Titel', () => {
    // „Mitte" als Ort einer Wohnung in Hagen ist für jede Umkreisrechnung
    // wertlos — und auf dem Bildschirm sah es aus, als gäbe es eine Stadt
    // namens Mitte.
    const [first] = immoweltAdapter.parse(page(html), {});
    expect(first.locationCity).toBe('Heilbronn');
    expect(first.locationPostal).toBe('74072');
  });

  it('macht aus dem Kartentitel eine kurze, unterscheidende Zeile', () => {
    // Der volle Titel wiederholt Preis, Zimmer und Fläche, die in der Zeile
    // ohnehin daneben stehen.
    const rows = immoweltAdapter.parse(page(html), {});
    for (const r of rows) {
      expect(r.title).not.toMatch(/€/);
      expect(r.title).not.toMatch(/m²/);
      expect(r.title.length).toBeLessThan(60);
    }
  });

  it('behält den vollen Text für den Leser', () => {
    // „frei ab 01.09.2026" steht nur im Kartentitel — der Textleser braucht ihn.
    const rows = immoweltAdapter.parse(page(html), {});
    expect(rows.some((r) => /frei ab/i.test(r.description))).toBe(true);
  });
});

describe('den Kartentitel lesen', () => {
  it('nimmt Typ, Ort, Preis, Zimmer und Fläche auseinander', () => {
    const f = parseCardTitle(
      'Wohnung zur Miete - Heilbronn - 835 € - 2 Zimmer, 63,7 m², 3. Geschoss, frei ab sofort',
    )!;
    expect(f.propertyLabel).toBe('Wohnung zur Miete');
    expect(f.city).toBe('Heilbronn');
    expect(f.rentCents).toBe(83500);
    expect(f.rooms).toBe(2);
    expect(f.livingSpaceSqm).toBe(63.7);
    expect(f.details).toMatch(/frei ab sofort/);
  });

  it('kommt mit dem Tausenderpunkt und halben Zimmern zurecht', () => {
    const f = parseCardTitle('Wohnung zur Miete - Heilbronn - 1.649 € - 4,5 Zimmer, 108,4 m²')!;
    expect(f.rentCents).toBe(164900);
    expect(f.rooms).toBe(4.5);
    expect(f.livingSpaceSqm).toBe(108.4);
  });

  it('lässt sich von einem Zusatz vor dem Ort nicht stören', () => {
    // „- Erstbezug -" schiebt sich zwischen Typ und Ort. Der Preis ist der
    // Anker, nicht die Position.
    const f = parseCardTitle('Wohnung zur Miete - Erstbezug - Bad Wimpfen - 1.590 € - 4 Zimmer, 99,1 m²')!;
    expect(f.city).toBe('Bad Wimpfen');
    expect(f.rentCents).toBe(159000);
  });

  it('gibt auf, wenn kein Preis dasteht', () => {
    expect(parseCardTitle('Wohnung zur Miete - Heilbronn')).toBeNull();
    expect(parseCardTitle('')).toBeNull();
  });
});

describe('die Trefferliste lesen', () => {
  it('findet die Anzeigen der gespeicherten Seite', () => {
    const found = immoweltAdapter.parse(page(html), {});
    expect(found.length).toBeGreaterThanOrEqual(4);
    for (const l of found) {
      expect(l.url).toMatch(/^https:\/\/www\.immowelt\.de\/expose\/[0-9a-f-]{36}$/);
      // Kurz ist hier Absicht (siehe „Ort und Titel"), aber nie leer.
      expect(l.title.trim().length).toBeGreaterThan(3);
    }
  });

  it('liest Preis, Zimmer und Fläche mit', () => {
    const [first] = immoweltAdapter.parse(page(html), {});
    const s = first.structured!;
    expect(s.rooms).toBeGreaterThan(0);
    expect(s.livingSpaceSqm).toBeGreaterThan(0);
    // Kaltmiete oder Warmmiete — eins von beidem, nie geraten und nie beides.
    expect((s.kaltMieteCents ?? 0) + (s.warmMieteCents ?? 0)).toBeGreaterThan(0);
  });

  it('nimmt die Postleitzahl aus der Adresszeile', () => {
    const withPostal = immoweltAdapter.parse(page(html), {}).filter((l) => l.locationPostal);
    expect(withPostal.length).toBeGreaterThan(0);
    expect(withPostal[0].locationPostal).toMatch(/^\d{5}$/);
  });

  it('lässt WG-Zimmer weg', () => {
    // Eine andere Wohnform — danach wird gesondert gesucht und nicht als
    // Nebenprodukt einer Wohnungssuche.
    const found = immoweltAdapter.parse(page(html), {});
    expect(found.some((l) => /^WG-Zimmer/.test(l.title))).toBe(false);
  });

  it('führt keine Anzeige doppelt', () => {
    const urls = immoweltAdapter.parse(page(html), {}).map((l) => l.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('überlebt eine Seite ohne die Testhaken des Portals', () => {
    // `data-testid` gehört Immowelt und kann sich mit jedem Deploy ändern.
    // Dann fehlen Adresse und Anzeigentext — die Anzeige selbst darf nicht
    // verlorengehen.
    const ohne = html.replace(/data-testid="[^"]*"/g, '');
    const found = immoweltAdapter.parse(page(ohne), {});
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found[0].structured?.rooms).toBeGreaterThan(0);
  });

  it('wirft bei Unsinn nicht, sondern gibt nichts zurück', () => {
    expect(immoweltAdapter.parse(page(null), {})).toEqual([]);
    expect(immoweltAdapter.parse(page('<html>kaputt'), {})).toEqual([]);
  });
});

describe('die Suchadresse finden', () => {
  const fetched = (finalUrl: string | null, status = 200): FetchedPage => ({
    url: 'https://www.immowelt.de/suche/heilbronn/wohnungen/mieten',
    finalUrl,
    status,
    body: '',
    error: null,
    blocked: false,
  });

  it('merkt sich, wohin Immowelt weiterleitet', async () => {
    const target =
      'https://www.immowelt.de/suche/mieten/wohnung/baden-wurttemberg/heilbronn-74072/ad08de5420';
    const config = await immoweltAdapter.prepare!(
      { ...DEFAULT_QUERY, city: 'Heilbronn' },
      {},
      async () => fetched(target),
    );
    // Der Ort wandert mit: `parse` sieht die Anfrage nicht und braucht ihn für
    // die kurzen Adresszeilen, in denen die Stadt fehlt.
    expect(config).toEqual({ searchUrl: target, searchCity: 'Heilbronn' });
    expect(immoweltAdapter.buildUrls(DEFAULT_QUERY, config!)).toEqual([target]);
  });

  it('sucht lieber gar nicht als bundesweit', async () => {
    // Landet die Weiterleitung nicht auf einer Suchseite mit Ortskennung, ist
    // der Ort unbekannt — dann liefert eine Suche das ganze Land.
    const config = await immoweltAdapter.prepare!(
      { ...DEFAULT_QUERY, city: 'Ortohnenamen' },
      {},
      async () => fetched('https://www.immowelt.de/'),
    );
    expect(config).toBeNull();
  });

  it('fragt nicht noch einmal, wenn die Adresse schon feststeht', async () => {
    let calls = 0;
    const config = await immoweltAdapter.prepare!(
      { ...DEFAULT_QUERY, city: 'Heilbronn' },
      { searchUrl: 'https://www.immowelt.de/suche/mieten/wohnung/x/y/ad1' },
      async () => {
        calls += 1;
        return fetched(null);
      },
    );
    expect(calls).toBe(0);
    expect(config).not.toBeNull();
  });
});
