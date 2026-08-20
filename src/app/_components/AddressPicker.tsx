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
}: {
  defaultAddress?: string;
  defaultCity?: string;
  defaultPostalCode?: string;
}) {
  const [query, setQuery] = useState(defaultAddress);
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [picked, setPicked] = useState<Place | null>(null);
  const [manual, setManual] = useState(false);
  const [city, setCity] = useState(defaultCity);
  const [postalCode, setPostalCode] = useState(defaultPostalCode);

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
      {picked ? (
        <>
          <input type="hidden" name="workplaceLat" value={picked.lat} />
          <input type="hidden" name="workplaceLon" value={picked.lon} />
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

      {picked ? (
        <div className="addr-confirmed">
          <span className="addr-tick" aria-hidden>
            ✓
          </span>
          <span>
            <strong>{[postalCode, city].filter(Boolean).join(' ') || 'Ort übernommen'}</strong>
            <span className="addr-sub">Adresse bestätigt</span>
          </span>
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
