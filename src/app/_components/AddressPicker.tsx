'use client';

/**
 * The work address, picked from real places rather than typed and hoped over.
 *
 * The postcode entered here decides which regional sources get asked and which
 * adverts count as nearby — a typo does not look like an error, it looks like a
 * search that quietly returns the wrong town's flats. So the address is looked
 * up and chosen from results, and the postcode, town and coordinates are filled
 * in from the same record rather than by hand.
 *
 * Typing it in by hand stays available throughout. A geocoder that is down, or
 * an address it has never heard of, must never be the reason a candidate cannot
 * be created.
 */

import { useState } from 'react';
import { lookupAddressAction } from '@/app/actions';

interface Place {
  label: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  lat: number;
  lon: number;
}

const short = (p: Place) =>
  [p.street, [p.postalCode, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || p.label;

export function AddressPicker({
  defaultAddress = '',
  defaultCity = '',
  defaultPostalCode = '',
  defaultLat = null,
  defaultLon = null,
}: {
  defaultAddress?: string;
  defaultCity?: string;
  defaultPostalCode?: string;
  /** Coordinates already stored, so an existing address shows its map too. */
  defaultLat?: number | null;
  defaultLon?: number | null;
}) {
  const [query, setQuery] = useState(defaultAddress);
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [picked, setPicked] = useState<Place | null>(null);
  const [manual, setManual] = useState(false);
  const [city, setCity] = useState(defaultCity);
  const [postalCode, setPostalCode] = useState(defaultPostalCode);

  // What the map shows: the place just chosen, or the one already stored on the
  // profile. An address saved last month deserves the same check as a new one —
  // that is where a wrong one hides.
  const shown =
    picked ??
    (defaultLat != null && defaultLon != null
      ? ({ label: defaultAddress, street: null, postalCode: defaultPostalCode, city: defaultCity, lat: defaultLat, lon: defaultLon } as Place)
      : null);

  function startOver() {
    setPicked(null);
    setResults(null);
    setManual(false);
  }

  async function search() {
    setBusy(true);
    setMessage(null);
    setResults(null);
    try {
      const r = await lookupAddressAction(query);
      setResults(r.places);
      if (!r.ok) {
        setMessage(r.message);
        // A lookup that found nothing is exactly when somebody needs the
        // manual fields, so they are opened rather than merely offered.
        setManual(true);
      }
    } catch {
      setMessage('Adresssuche nicht erreichbar.');
      setManual(true);
    } finally {
      setBusy(false);
    }
  }

  function choose(p: Place) {
    setPicked(p);
    setResults(null);
    setQuery(short(p));
    setCity(p.city ?? '');
    setPostalCode(p.postalCode ?? '');
    setMessage(null);
  }

  return (
    <div className="stack-sm">
      {/* What actually gets saved. The visible box is the search box, and on a
          pick these carry the geocoder's own spelling and coordinates. */}
      <input type="hidden" name="workplaceAddress" value={query} />
      <input type="hidden" name="workplaceCity" value={city} />
      <input type="hidden" name="workplacePostalCode" value={postalCode} />
      {shown ? (
        <>
          <input type="hidden" name="workplaceLat" value={shown.lat} />
          <input type="hidden" name="workplaceLon" value={shown.lon} />
        </>
      ) : null}

      <label htmlFor="addr-q">Arbeitsort</label>
      <div className="addr-row">
        <input
          id="addr-q"
          className="input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Salinenstraße 2, Bad Rappenau"
          autoComplete="off"
        />
        <button type="button" className="btn" onClick={() => void search()} disabled={busy || query.trim().length < 4}>
          {busy ? 'Sucht …' : 'Suchen'}
        </button>
      </div>

      {/* A picked address is still a guess until somebody looks at it. The
          geocoder happily answers "Hamburg" for a clinic in Heide if the query
          was loose, and nothing on a form of text fields would show that. A
          map does, in one glance, without anyone having to know the postcode
          of a town they have never been to. */}
      {shown ? (
        <div className="addr-confirmed">
          <div className="addr-confirmed-head">
            <span className="addr-tick" aria-hidden>
              ✓
            </span>
            <span className="addr-confirmed-text">
              <strong>{[postalCode, city].filter(Boolean).join(' ') || 'Ort übernommen'}</strong>
              <span className="addr-sub">{picked ? 'Adresse bestätigt' : 'Gespeicherte Adresse'}</span>
            </span>
            <button type="button" className="btn sm" onClick={startOver}>
              Ändern
            </button>
          </div>
          {shown.lat != null && shown.lon != null ? (
            <iframe
              className="addr-map"
              title="Karte des Arbeitsorts"
              loading="lazy"
              referrerPolicy="no-referrer"
              src={mapUrl(shown.lat, shown.lon)}
            />
          ) : null}
        </div>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="addr-results">
          {results.map((p, i) => (
            <li key={i}>
              <button type="button" className="addr-option" onClick={() => choose(p)}>
                <strong>{short(p)}</strong>
                <span className="addr-sub">{p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {message ? <p className="field-hint">{message}</p> : null}

      {!picked && !manual ? (
        <button type="button" className="btn ghost sm" onClick={() => setManual(true)}>
          Von Hand eintragen
        </button>
      ) : null}

      {manual && !picked ? (
        <div className="grid-2">
          <div className="field">
            <label htmlFor="addr-city">Stadt</label>
            <input
              id="addr-city"
              className="input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Bad Rappenau"
            />
          </div>
          <div className="field">
            <label htmlFor="addr-plz">PLZ</label>
            <input
              id="addr-plz"
              className="input"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="74906"
              inputMode="numeric"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * An OpenStreetMap frame centred on the point, with a marker.
 *
 * Deliberately their plain embed rather than a mapping library: it is one
 * iframe, needs no key and no script, and this is a glance-and-confirm, not a
 * map anybody works in.
 */
function mapUrl(lat: number, lon: number): string {
  const d = 0.004; // roughly a few streets either way
  const bbox = [lon - d, lat - d / 2, lon + d, lat + d / 2].join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;
}
