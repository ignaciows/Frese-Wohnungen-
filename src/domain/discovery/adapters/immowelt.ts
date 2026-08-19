/**
 * Immowelt lesen — die Ergebnisliste des Portals, so wie sie ein Browser sieht.
 *
 * Warum das geht und bei ImmoScout24 nicht: Immowelt liefert die Trefferliste
 * als fertiges HTML aus und verbietet `/suche/` in seiner robots.txt nicht
 * (nachgesehen: verboten sind dort Formulare, Karten, Druckansichten und ein
 * paar Sonderpfade, nicht die Suche). ImmoScout24 antwortet einem Abruf ohne
 * Browser mit `401 Ich bin kein Roboter` — eine Schranke, keine Bitte, und um
 * die geht dieses Programm nicht herum. Für ImmoScout bleibt der Suchauftrag
 * per E-Mail.
 *
 * Zwei Eigenheiten, die das Lesen hier einfacher machen als anderswo:
 *
 *  1. **Die Ortskennung holt sich die Seite selbst.** Immowelts Such-URLs
 *     brauchen eine interne Kennung (`ad08de5420` für Heilbronn). Die freundliche
 *     Adresse `/suche/heilbronn/wohnungen/mieten` leitet auf genau diese URL
 *     weiter — also einmal abrufen, Zieladresse merken, fertig. Kein Katalog
 *     von Ortskennungen, der veraltet.
 *
 *  2. **Der `title` der Karte trägt alles.** „Wohnung zur Miete - Heilbronn -
 *     835 € - 2 Zimmer, 63,7 m², 3. Geschoss, frei ab sofort" — Typ, Ort, Preis,
 *     Zimmer, Fläche, Einzugsdatum in einem Zug. Die CSS-Klassen sind gehashte
 *     Zufallsnamen und ändern sich mit jedem Deploy; `href` und `title` ändern
 *     sich nicht, weil Suchmaschinen und Screenreader daran hängen.
 *
 * Der Titel ist deshalb das Rückgrat. Was die Karte darüber hinaus hergibt —
 * ob der Preis Kalt- oder Warmmiete ist, die genaue Adresse mit Postleitzahl,
 * ein Stück Anzeigentext — steht an `data-testid`-Attributen, und die sind für
 * Immowelts eigene Tests da und können sich ändern. Deshalb *ergänzen* sie nur:
 * fällt eins weg, wird die Anzeige ärmer, aber sie fällt nicht aus.
 *
 * Was diese Liste **nicht** hergibt: mehr als die erste Seite. Immowelt lädt
 * weitere Treffer per JavaScript nach, und Seitenparameter liefern dieselben
 * 24 Anzeigen zurück (ausprobiert: `?sp=2`, `?page=2`, `?pageIndex=2`, `/seite-2`).
 * Vierundzwanzig frische Anzeigen je Ort und Durchlauf sind das Angebot —
 * ehrlicher als eine Schleife, die dreimal dasselbe holt.
 */

import type {
  AdapterConfig,
  DiscoveredListing,
  DiscoveryAdapter,
  DiscoveryQuery,
  FetchedPage,
} from '../types';
import { cfgString, slugify } from '../types';

const BASE = 'https://www.immowelt.de';

/** Karten, deren Titel so anfängt, sind keine eigene Wohnung. */
const NOT_A_FLAT = /^(WG-Zimmer|Zimmer)\b/i;

/**
 * Die Suchadresse für eine Stadt, über Immowelts eigene Weiterleitung.
 *
 * Gibt `null` zurück, wenn die Weiterleitung nicht dort landet, wo sie soll —
 * lieber gar nicht suchen als bundesweit.
 */
async function lookupSearchUrl(
  city: string,
  fetchPage: (url: string) => Promise<FetchedPage>,
): Promise<string | null> {
  const friendly = `${BASE}/suche/${slugify(city)}/wohnungen/mieten`;
  const page = await fetchPage(friendly);
  const landed = page.finalUrl ?? (page.status === 200 ? friendly : null);
  if (!landed) return null;
  // Muss eine Suchseite mit Ortskennung sein. Wer auf der Startseite landet,
  // hat einen Ort erwischt, den Immowelt nicht kennt.
  return /\/suche\/mieten\/wohnung\/[^/]+\/[^/]+\/[a-z0-9]+/i.test(landed) ? landed : null;
}

/** „1.250" → 125000 Cent. Ohne Zahl: null. */
function euroToCents(raw: string): number | null {
  const cleaned = raw.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** „63,7" → 63.7 */
function decimal(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export interface CardFacts {
  propertyLabel: string;
  city: string | null;
  rentCents: number | null;
  rooms: number | null;
  livingSpaceSqm: number | null;
  details: string;
}

/**
 * Den Kartentitel auseinandernehmen.
 *
 * Aufbau: `Typ zur Miete[ - Zusatz] - Ort - Preis € - Angaben`. Der Preis ist
 * der Anker: davor steht der Ort, ganz vorn der Typ, dahinter die Angaben.
 * Fehlt der Preis, ist es keine Anzeige, die wir lesen können.
 */
export function parseCardTitle(title: string): CardFacts | null {
  const parts = title.split(' - ').map((p) => p.trim()).filter(Boolean);
  const priceIndex = parts.findIndex((p) => /^[\d.,]+\s*€$/.test(p));
  if (priceIndex < 1) return null;

  const details = parts.slice(priceIndex + 1).join(', ');
  const rooms = details.match(/([\d,]+)\s*Zimmer/i);
  const sqm = details.match(/([\d,]+)\s*m²/i);

  return {
    propertyLabel: parts[0],
    city: parts[priceIndex - 1] || null,
    rentCents: euroToCents(parts[priceIndex].replace(/\s*€$/, '')),
    rooms: rooms ? decimal(rooms[1]) : null,
    livingSpaceSqm: sqm ? decimal(sqm[1]) : null,
    details,
  };
}

/** Sichtbarer Text hinter einem `data-testid`, ohne Auszeichnung. */
function textAfter(block: string, testId: string, span = 700): string | null {
  const at = block.indexOf(`data-testid="${testId}"`);
  if (at === -1) return null;
  const text = block
    .slice(at, at + span)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/^[^>]*>?/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/**
 * Kalt- oder Warmmiete — die Karte schreibt es daneben.
 *
 * Ohne Angabe wird Kaltmiete angenommen, wie bei den anderen Portalen auch:
 * das ist der Normalfall bei Mietanzeigen, und die App weist eine geschätzte
 * Warmmiete ohnehin als „ca." aus, statt sie als Tatsache hinzustellen.
 */
function priceKind(block: string): 'warm' | 'kalt' {
  const label = textAfter(block, 'cardmfe-price-testid', 300) ?? '';
  return /warmmiete|gesamtmiete|warm/i.test(label) ? 'warm' : 'kalt';
}

/** „Sinsheimer Straße, Böckingen, Heilbronn (74080)" → Adresse und PLZ. */
function addressFrom(block: string): { raw: string | null; postal: string | null } {
  const raw = textAfter(block, 'cardmfe-description-box-address', 400);
  if (!raw) return { raw: null, postal: null };
  const cut = raw.split(/\s{2,}/)[0].trim();
  const postal = cut.match(/\((\d{5})\)|\b(\d{5})\b/);
  return { raw: cut || null, postal: postal ? (postal[1] ?? postal[2]) : null };
}

export const immoweltAdapter: DiscoveryAdapter = {
  key: 'immowelt',
  label: 'Immowelt',
  description:
    'Liest die Trefferliste von immowelt.de für den Ort des Kandidaten — die erste Seite, rund 24 Anzeigen je Durchlauf.',
  configKeys: [
    {
      key: 'searchUrl',
      required: false,
      hint: 'Wird automatisch ermittelt. Nur ausfüllen, um eine bestimmte Suche festzunageln.',
    },
  ],

  async prepare(query, config, fetchPage) {
    if (cfgString(config, 'searchUrl')) return config;
    if (!query.city) return null;
    const url = await lookupSearchUrl(query.city, fetchPage);
    return url ? { ...config, searchUrl: url } : null;
  },

  buildUrls(_query: DiscoveryQuery, config: AdapterConfig): string[] {
    const url = cfgString(config, 'searchUrl');
    return url ? [url] : [];
  },

  parse(page: FetchedPage, _config: AdapterConfig): DiscoveredListing[] {
    if (!page.body) return [];
    const out: DiscoveredListing[] = [];
    const seen = new Set<string>();

    // Jede Karte fängt mit ihrer eigenen id an; das gibt saubere Blöcke, in
    // denen Preis, Adresse und Text zur selben Anzeige gehören.
    for (const block of page.body.split(/<div id="classified-card-/)) {
      // Adresse und Titel werden getrennt gesucht und nicht in einem
      // gemeinsamen Ausdruck: zwischen beiden stehen je nach Anzeige mal drei,
      // mal acht weitere Attribute, und ein Ausdruck, der die alle überspringen
      // muss, fällt beim ersten neuen Attribut aus.
      const href = block.match(/href="(https:\/\/www\.immowelt\.de\/expose\/[0-9a-f-]{36})"/);
      if (!href) continue;
      const url = href[1];
      if (seen.has(url)) continue;

      // Der erste Titel im Block, der sich als Kartentitel lesen lässt.
      let facts: CardFacts | null = null;
      let title = '';
      for (const m of block.matchAll(/title="([^"]{20,})"/g)) {
        const candidate = m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
        const parsed = parseCardTitle(candidate);
        if (parsed) {
          facts = parsed;
          title = candidate;
          break;
        }
      }
      if (!facts) continue;
      // WG-Zimmer sind eine andere Wohnform; danach wird gesondert gesucht und
      // nicht als Nebenprodukt einer Wohnungssuche.
      if (NOT_A_FLAT.test(facts.propertyLabel)) continue;

      seen.add(url);
      const address = addressFrom(block);
      const teaser = textAfter(block, 'cardmfe-description-text-test-id', 900);
      const warm = priceKind(block) === 'warm';

      out.push({
        url,
        title,
        // Was die Liste zeigt, mehr nicht. Die Angaben aus dem Titel kommen
        // mit hinein, damit der Textleser „frei ab 01.09.2026" findet — auf
        // der Liste steht kein anderes Einzugsdatum.
        description: [facts.details, teaser].filter(Boolean).join('\n'),
        locationRaw: address.raw ?? [address.postal, facts.city].filter(Boolean).join(' ') ?? undefined,
        locationCity: facts.city,
        locationPostal: address.postal,
        structured: {
          ...(facts.rentCents != null
            ? warm
              ? { warmMieteCents: facts.rentCents }
              : { kaltMieteCents: facts.rentCents }
            : {}),
          ...(facts.rooms != null ? { rooms: facts.rooms } : {}),
          ...(facts.livingSpaceSqm != null ? { livingSpaceSqm: facts.livingSpaceSqm } : {}),
        },
      });
    }

    return out;
  },
};
