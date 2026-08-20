/**
 * Turning a typed address into a confirmed place.
 *
 * Typing "Salinenstraße 2" and hoping is how a candidate ends up being searched
 * for in the wrong town — and the postcode drives everything downstream: which
 * regional sources are asked, which flats count as nearby, whether an advert
 * three hundred kilometres away is caught. A wrong postcode is not a cosmetic
 * error, it is a search that silently looks in the wrong place.
 *
 * So the address is looked up and *picked from real results*, the way the
 * portals do it. What comes back is a place that demonstrably exists, with its
 * postcode, town and coordinates filled in from the same record.
 *
 * OpenStreetMap's Nominatim rather than Google: it needs no API key, no billing
 * account and no per-request contract, which for a handful of lookups per
 * candidate is the difference between working today and waiting for someone to
 * set up a payment method. Their usage policy asks for an identifying
 * User-Agent and at most one request a second — both of which this respects,
 * and neither of which is close to binding for an interactive lookup somebody
 * triggers by hand.
 */

const DEFAULT_BASE = 'https://nominatim.openstreetmap.org';

export interface PlaceCandidate {
  /** One-line address as the geocoder spells it, for the pick list. */
  label: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  lat: number;
  lon: number;
}

export interface LookupResult {
  ok: boolean;
  places: PlaceCandidate[];
  /** German, shown when nothing usable came back. */
  message: string | null;
}

/** Nominatim asks for one request a second; this keeps us under it. */
let lastCallAt = 0;
const MIN_GAP_MS = 1100;

async function pace(): Promise<void> {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

function userAgent(): string {
  const contact = process.env.GEOCODER_USER_AGENT?.trim();
  // The policy wants something that identifies the deployment and can be
  // contacted. Falling back to a generic string is better than sending none.
  return contact || 'FreseWohnung/1.0 (internes Werkzeug zur Wohnungssuche)';
}

export async function lookupAddress(query: string): Promise<LookupResult> {
  const q = query.trim();
  if (q.length < 4) {
    return { ok: false, places: [], message: 'Bitte mehr eingeben — Straße, Hausnummer und Ort.' };
  }

  const base = process.env.GEOCODER_BASE_URL?.trim() || DEFAULT_BASE;
  const url =
    `${base}/search?` +
    new URLSearchParams({
      q,
      format: 'jsonv2',
      addressdetails: '1',
      // The people using this place candidates in Germany. Restricting the
      // search stops "Bad Rappenau" matching a street in another country.
      countrycodes: 'de',
      limit: '5',
    }).toString();

  try {
    await pace();
    const res = await fetch(url, {
      headers: { 'user-agent': userAgent(), 'accept-language': 'de' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return { ok: false, places: [], message: `Adresssuche nicht erreichbar (HTTP ${res.status}).` };
    }

    const raw = (await res.json()) as unknown;
    const places = Array.isArray(raw) ? raw.map(toPlace).filter((p): p is PlaceCandidate => p !== null) : [];

    if (places.length === 0) {
      return {
        ok: false,
        places: [],
        message: 'Keine Adresse gefunden. Bitte anders schreiben oder unten von Hand eintragen.',
      };
    }
    return { ok: true, places, message: null };
  } catch (err) {
    const reason = (err as Error).name === 'TimeoutError' ? 'Zeitüberschreitung' : (err as Error).message;
    return { ok: false, places: [], message: `Adresssuche fehlgeschlagen: ${reason.slice(0, 120)}` };
  }
}

interface NominatimAddress {
  road?: string;
  house_number?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
}

function toPlace(row: unknown): PlaceCandidate | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { display_name?: unknown; lat?: unknown; lon?: unknown; address?: NominatimAddress };
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const a = r.address ?? {};
  // Nominatim spells the settlement differently depending on its size; a
  // village is not a "city" but it is still where somebody works.
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? null;
  const street = a.road ? [a.road, a.house_number].filter(Boolean).join(' ') : null;

  return {
    label: typeof r.display_name === 'string' ? r.display_name : [street, city].filter(Boolean).join(', '),
    street,
    postalCode: a.postcode ?? null,
    city,
    lat,
    lon,
  };
}

/** The short form shown in the pick list — the full display_name is a mouthful. */
export function shortLabel(p: PlaceCandidate): string {
  const parts = [p.street, [p.postalCode, p.city].filter(Boolean).join(' ')].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : p.label;
}
