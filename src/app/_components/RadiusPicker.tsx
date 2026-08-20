'use client';

/**
 * How far from work a flat may be — in kilometres, chosen from steps.
 *
 * It used to ask for a maximum commute in minutes. Nobody knows what
 * "35 minutes" means before they know whether the person drives, cycles or
 * takes a bus, and the app has no way to know either — so the number was
 * guessed on one side and estimated on the other. Every portal filter is a
 * radius, the candidate's own question is "how far out may I look", and a
 * distance is something both ends of the app agree on.
 *
 * Steps rather than a free number: the difference between 7 and 8 km does not
 * exist in this decision, and a row of buttons is one tap instead of a field to
 * clear and retype.
 */

import { useState } from 'react';

const STEPS = [1, 3, 5, 10, 20, 40] as const;

export function RadiusPicker({ defaultKm = 10, name = 'radiusKm' }: { defaultKm?: number; name?: string }) {
  const [km, setKm] = useState<number>(defaultKm);

  return (
    <div className="field">
      <input type="hidden" name={name} value={km} />
      <label>
        Umkreis um den Arbeitsort: <strong>{km} km</strong>
      </label>
      <div className="choice-row" role="group" aria-label="Umkreis">
        {STEPS.map((v) => (
          <button
            key={v}
            type="button"
            className={`choice ${km === v ? 'is-on' : ''}`}
            aria-pressed={km === v}
            onClick={() => setKm(v)}
          >
            {v} km
          </button>
        ))}
      </div>
    </div>
  );
}
