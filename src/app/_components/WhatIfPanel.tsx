'use client';

import { useEffect, useState, useTransition } from 'react';
import { simulateProfileAction, applySimulatedProfileAction } from '@/app/actions';
import { SubmitButton } from '@/app/_components/SubmitButton';

interface Props {
  candidateCaseId: string;
  current: {
    maxWarmmieteEuros: number;
    minRooms: number;
    maxCommuteMinutes: number;
    radiusKm: number;
    furnished: 'REQUIRED' | 'PREFERRED' | 'EITHER';
    temporaryMode: boolean;
  };
  /** Open by default when the inbox has nothing usable. */
  startOpen?: boolean;
}

type Sim = Awaited<ReturnType<typeof simulateProfileAction>>;

export function WhatIfPanel({ candidateCaseId, current, startOpen = false }: Props) {
  const [open, setOpen] = useState(startOpen);
  const [values, setValues] = useState(current);
  const [sim, setSim] = useState<Sim | null>(null);
  const [pending, start] = useTransition();

  // Re-simulate whenever a knob moves. Cheap: it re-ranks listings we already
  // hold, it does not touch the portals or the saved profile.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await simulateProfileAction({ candidateCaseId, ...values });
        if (!cancelled) setSim(r);
      } catch {
        /* leave the previous result on screen */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, candidateCaseId, values]);

  const changed =
    values.maxWarmmieteEuros !== current.maxWarmmieteEuros ||
    values.minRooms !== current.minRooms ||
    values.maxCommuteMinutes !== current.maxCommuteMinutes ||
    values.radiusKm !== current.radiusKm ||
    values.furnished !== current.furnished ||
    values.temporaryMode !== current.temporaryMode;

  if (!open) {
    return (
      <button type="button" className="btn soft" onClick={() => setOpen(true)}>
        Suchkriterien durchspielen — was bringt mehr Treffer?
      </button>
    );
  }

  return (
    <div className="card" style={{ borderColor: 'var(--brand-border)' }}>
      <div className="card-head" style={{ background: 'var(--brand-soft)' }}>
        <h3>Suchkriterien durchspielen</h3>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>
          Schließen
        </button>
      </div>

      <div className="card-body stack">
        {sim ? (
          <div
            className={`callout ${
              sim.diagnosis.kind === 'FINE'
                ? 'success'
                : sim.diagnosis.kind === 'CRITERIA_TOO_TIGHT'
                  ? 'warning'
                  : 'danger'
            }`}
          >
            <span className="callout-icon" aria-hidden>
              {sim.diagnosis.kind === 'FINE' ? '✓' : '!'}
            </span>
            <div>{sim.diagnosis.message}</div>
          </div>
        ) : null}

        {/* --- live result -------------------------------------------- */}
        <div className="grid-4">
          <div className="stat accent">
            <div className="stat-value">{sim ? sim.result.usable : '—'}</div>
            <div className="stat-label">
              brauchbar{' '}
              {sim && sim.result.gained !== 0 ? (
                <strong style={{ color: sim.result.gained > 0 ? 'var(--success)' : 'var(--danger)' }}>
                  ({sim.result.gained > 0 ? '+' : ''}
                  {sim.result.gained})
                </strong>
              ) : null}
            </div>
          </div>
          <div className="stat">
            <div className="stat-value">{sim ? sim.result.compatible : '—'}</div>
            <div className="stat-label">passend</div>
          </div>
          <div className="stat">
            <div className="stat-value">{sim ? sim.result.nearMatch : '—'}</div>
            <div className="stat-label">fast passend</div>
          </div>
          <div className="stat">
            <div className="stat-value">{sim ? sim.totalListings : '—'}</div>
            {/* Only the live ones are simulated — moving a slider cannot bring
                a let flat back. Labelled "insgesamt" it contradicted the tab
                above, which counts the expired ones too, and the reader was
                left to work out which total was lying. */}
            <div className="stat-label">aktive Anzeigen geprüft</div>
          </div>
        </div>

        {/* --- knobs ---------------------------------------------------- */}
        <div className="grid-2">
          <div>
            <label htmlFor="wi-budget">
              Max. Warmmiete: <strong>{values.maxWarmmieteEuros} €</strong>
            </label>
            <input
              id="wi-budget"
              type="range"
              min={300}
              max={2000}
              step={25}
              value={values.maxWarmmieteEuros}
              onChange={(e) => setValues((v) => ({ ...v, maxWarmmieteEuros: Number(e.target.value) }))}
              style={{ width: '100%', accentColor: 'var(--brand)' }}
            />
          </div>
          <div>
            <label htmlFor="wi-commute">
              Max. Anfahrt: <strong>{values.maxCommuteMinutes} min</strong>
            </label>
            <input
              id="wi-commute"
              type="range"
              min={10}
              max={120}
              step={5}
              value={values.maxCommuteMinutes}
              onChange={(e) => setValues((v) => ({ ...v, maxCommuteMinutes: Number(e.target.value) }))}
              style={{ width: '100%', accentColor: 'var(--brand)' }}
            />
          </div>
          <div>
            <label htmlFor="wi-radius">
              Umkreis: <strong>{values.radiusKm} km</strong>
            </label>
            <input
              id="wi-radius"
              type="range"
              min={5}
              max={100}
              step={5}
              value={values.radiusKm}
              onChange={(e) => setValues((v) => ({ ...v, radiusKm: Number(e.target.value) }))}
              style={{ width: '100%', accentColor: 'var(--brand)' }}
            />
          </div>
          <div>
            <label htmlFor="wi-rooms">
              Mindest-Zimmer: <strong>{values.minRooms}</strong>
            </label>
            <input
              id="wi-rooms"
              type="range"
              min={1}
              max={6}
              step={0.5}
              value={values.minRooms}
              onChange={(e) => setValues((v) => ({ ...v, minRooms: Number(e.target.value) }))}
              style={{ width: '100%', accentColor: 'var(--brand)' }}
            />
          </div>
        </div>

        <div className="row-wrap">
          <div>
            <label htmlFor="wi-furnished">Möblierung</label>
            <select
              id="wi-furnished"
              className="select"
              style={{ width: 210 }}
              value={values.furnished}
              onChange={(e) =>
                setValues((v) => ({ ...v, furnished: e.target.value as Props['current']['furnished'] }))
              }
            >
              <option value="REQUIRED">Zwingend möbliert</option>
              <option value="PREFERRED">Möbliert bevorzugt</option>
              <option value="EITHER">Egal</option>
            </select>
          </div>
          <div className="checkline" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>
            <input
              id="wi-temp"
              type="checkbox"
              checked={values.temporaryMode}
              onChange={(e) => setValues((v) => ({ ...v, temporaryMode: e.target.checked }))}
            />
            <label htmlFor="wi-temp">Übergangswohnen einbeziehen</label>
          </div>
        </div>

        {/* --- what single change helps most ---------------------------- */}
        {sim && sim.suggestions.length > 0 ? (
          <div className="stack-sm">
            <h4>Was am meisten bringt</h4>
            {sim.suggestions.map((s) => (
              <button
                key={s.key}
                type="button"
                className="step"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() =>
                  setValues((v) => ({
                    ...v,
                    ...(s.overrides.maxWarmmieteCents != null
                      ? { maxWarmmieteEuros: Math.round(s.overrides.maxWarmmieteCents / 100) }
                      : {}),
                    ...(s.overrides.minRooms != null ? { minRooms: s.overrides.minRooms } : {}),
                    ...(s.overrides.maxCommuteMinutes != null
                      ? { maxCommuteMinutes: s.overrides.maxCommuteMinutes }
                      : {}),
                    ...(s.overrides.radiusKm != null ? { radiusKm: s.overrides.radiusKm } : {}),
                    ...(s.overrides.furnished != null ? { furnished: s.overrides.furnished } : {}),
                    ...(s.overrides.temporaryMode != null
                      ? { temporaryMode: s.overrides.temporaryMode }
                      : {}),
                  }))
                }
              >
                <span className="step-num">+{s.gained}</span>
                <span className="step-main">
                  <span className="step-title">{s.label}</span>
                  <span className="step-desc">{s.usable} brauchbare Anzeigen danach</span>
                </span>
                <span className="btn sm soft nowrap">Ausprobieren</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* --- which ads actually come and go ---------------------------- */}
        {sim && changed && (sim.preview.addedTotal > 0 || sim.preview.removedTotal > 0) ? (
          <div className="grid-2">
            {sim.preview.addedTotal > 0 ? (
              <div className="stack-sm">
                <h4 style={{ color: 'var(--success)' }}>
                  Kommt dazu ({sim.preview.addedTotal})
                </h4>
                <ul className="list">
                  {sim.preview.added.map((l) => (
                    <li key={l.id} className="list-row">
                      <PreviewRow listing={l} />
                    </li>
                  ))}
                </ul>
                {sim.preview.addedTotal > sim.preview.added.length ? (
                  <span className="small muted">
                    … und {sim.preview.addedTotal - sim.preview.added.length} weitere
                  </span>
                ) : null}
              </div>
            ) : null}

            {sim.preview.removedTotal > 0 ? (
              <div className="stack-sm">
                <h4 style={{ color: 'var(--danger)' }}>Fällt weg ({sim.preview.removedTotal})</h4>
                <ul className="list">
                  {sim.preview.removed.map((l) => (
                    <li key={l.id} className="list-row">
                      <PreviewRow listing={l} />
                    </li>
                  ))}
                </ul>
                {sim.preview.removedTotal > sim.preview.removed.length ? (
                  <span className="small muted">
                    … und {sim.preview.removedTotal - sim.preview.removed.length} weitere
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {sim && sim.suggestions.length === 0 && sim.diagnosis.kind !== 'FINE' ? (
          <p className="small muted">
            Keine einzelne Lockerung bringt zusätzliche Treffer — hier hilft nur, mehr Quellen
            durchzugehen oder eine Übergangslösung einzuplanen.
          </p>
        ) : null}
      </div>

      <div className="card-foot row-between">
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => setValues(current)}
          disabled={!changed}
        >
          Zurücksetzen
        </button>
        <form
          action={applySimulatedProfileAction}
          onSubmit={() => start(() => undefined)}
          className="row"
        >
          <input type="hidden" name="candidateCaseId" value={candidateCaseId} />
          <input type="hidden" name="maxWarmmieteEuros" value={values.maxWarmmieteEuros} />
          <input type="hidden" name="minRooms" value={values.minRooms} />
          <input type="hidden" name="maxCommuteMinutes" value={values.maxCommuteMinutes} />
          <input type="hidden" name="radiusKm" value={values.radiusKm} />
          <input type="hidden" name="furnished" value={values.furnished} />
          <input type="hidden" name="temporaryMode" value={String(values.temporaryMode)} />
          <span className="small muted">
            {changed ? 'Änderungen sind noch nicht gespeichert.' : 'Unverändert.'}
          </span>
          <SubmitButton className="btn primary" disabled={!changed || pending}>
            Ins Suchprofil übernehmen
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

/** One line in the "comes in / drops out" preview. */
function PreviewRow({
  listing,
}: {
  listing: {
    title: string;
    city: string | null;
    url: string;
    monthlyCents: number | null;
    rooms: number | null;
    sourceName: string;
    status: string;
  };
}) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <a href={listing.url} target="_blank" rel="noopener noreferrer" className="small">
        {listing.title.slice(0, 70)}
      </a>
      <span className="small muted">
        {[
          listing.monthlyCents != null ? `${Math.round(listing.monthlyCents / 100)} €` : 'Preis unklar',
          listing.rooms != null ? `${listing.rooms} Zi.` : null,
          listing.city,
          listing.sourceName,
          // A flat already written to is not really a gain — say so.
          listing.status === 'CONTACTED' ? 'bereits kontaktiert' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  );
}
