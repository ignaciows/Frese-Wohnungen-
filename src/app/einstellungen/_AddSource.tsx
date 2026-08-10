'use client';

import { useState, useTransition } from 'react';
import { probeSourceAction, createSourceFormAction } from '@/app/actions';

type Report = Awaited<ReturnType<typeof probeSourceAction>>;

/**
 * "Paste a website, get a working source."
 *
 * The long tail of German rental stock — municipal housing companies,
 * cooperatives, regional agents — is hundreds of small sites with a handful of
 * flats each. Waiting for a developer to write an adapter per site means those
 * flats are never seen. This probes the site live, says what it found, and
 * pre-fills the configuration, so adding one is a job for whoever is already
 * looking at it.
 *
 * It reports failure just as plainly as success: a site that renders its
 * results with JavaScript, or that turns us away, says so instead of being
 * added as a source that silently returns nothing forever.
 */
export function AddSource({ categories }: { categories: Array<{ value: string; label: string }> }) {
  const [url, setUrl] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [chosen, setChosen] = useState(0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function probe() {
    if (!url.trim()) return;
    setError(null);
    setReport(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set('url', url.trim());
        const result = await probeSourceAction(fd);
        setReport(result);
        setChosen(0);
      } catch (err) {
        setError((err as Error).message || 'Die Adresse konnte nicht geprüft werden.');
      }
    });
  }

  const candidate = report?.candidates[chosen] ?? null;
  const suggestedName = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head">
        <h2>Quelle hinzufügen</h2>
        <span className="sub">Adresse einfügen — die App prüft, ob und wie sie lesbar ist.</span>
      </div>

      <div className="card-body stack">
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="probe-url">Adresse der Ergebnisliste</label>
            <input
              id="probe-url"
              className="input"
              placeholder="https://www.stadtbau-beispiel.de/wohnungsangebote"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <span className="small muted">
              Am besten die Seite, auf der die freien Wohnungen aufgelistet sind — nicht die Startseite.
            </span>
          </div>
          <button type="button" className="btn" onClick={probe} disabled={pending || !url.trim()}>
            {pending ? 'Prüft …' : 'Prüfen'}
          </button>
        </div>

        {error ? (
          <div className="callout danger">
            <span className="callout-icon" aria-hidden>
              !
            </span>
            <div>{error}</div>
          </div>
        ) : null}

        {report ? (
          <div
            className={`callout ${report.candidates.length > 0 ? 'success' : report.blocked || !report.robotsAllowed ? 'danger' : 'warning'}`}
          >
            <span className="callout-icon" aria-hidden>
              {report.candidates.length > 0 ? '✓' : '!'}
            </span>
            <div>{report.note}</div>
          </div>
        ) : null}

        {report && report.candidates.length > 1 ? (
          <div className="stack-sm">
            <h4>Gefundene Verfahren</h4>
            {report.candidates.map((c, i) => (
              <button
                key={`${c.adapter}-${i}`}
                type="button"
                className="step"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => setChosen(i)}
                aria-pressed={chosen === i}
              >
                <span className="step-num">{c.confidence}</span>
                <span className="step-main">
                  <span className="step-title">{c.adapter}</span>
                  <span className="step-desc">{c.evidence}</span>
                </span>
                <span className="btn sm soft nowrap">{chosen === i ? 'gewählt' : 'wählen'}</span>
              </button>
            ))}
          </div>
        ) : null}

        {candidate ? (
          <form action={createSourceFormAction} className="subcard stack">
            <strong className="small">Als Quelle anlegen</strong>
            <div className="grid-2">
              <div>
                <label htmlFor="new-name">Name</label>
                <input id="new-name" name="name" className="input" defaultValue={suggestedName} required />
              </div>
              <div>
                <label htmlFor="new-category">Art</label>
                <select id="new-category" name="category" className="input" defaultValue="GENERAL_PORTAL">
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="new-poll">Wie oft prüfen (Minuten)</label>
                <input
                  id="new-poll"
                  name="pollIntervalMinutes"
                  type="number"
                  min={5}
                  className="input"
                  defaultValue={candidate.adapter === 'feed' ? 15 : 60}
                />
                <span className="small muted">
                  Schnelle Marktplätze alle 10–15 Minuten, kommunale Anbieter täglich reicht.
                </span>
              </div>
              <div>
                <label htmlFor="new-adapter">Verfahren</label>
                <input id="new-adapter" name="discoveryAdapter" className="input" defaultValue={candidate.adapter} readOnly />
              </div>
            </div>

            <div>
              <label htmlFor="new-config">Konfiguration</label>
              <textarea
                id="new-config"
                name="config"
                className="input"
                rows={3}
                defaultValue={JSON.stringify(candidate.config, null, 1)}
              />
            </div>

            <input type="hidden" name="websiteUrl" value={url.trim()} />
            <div className="checkline">
              <input id="new-enable" name="enable" type="checkbox" value="true" defaultChecked />
              <label htmlFor="new-enable">Sofort für die automatische Suche aktivieren</label>
            </div>
            <div className="row">
              <button type="submit" className="btn primary">
                Quelle anlegen
              </button>
            </div>
          </form>
        ) : null}

        {report && report.candidates.length === 0 && report.reachable && !report.blocked ? (
          <p className="small muted">
            Solche Seiten bauen ihre Ergebnisliste erst im Browser zusammen, deshalb ist per Abruf nichts zu
            sehen. Zwei Wege, die trotzdem funktionieren: einen E-Mail-Suchauftrag beim Anbieter einrichten
            und die Adresse des gemeinsamen Postfachs eintragen, oder die Quelle als manuellen Task führen.
          </p>
        ) : null}
      </div>
    </div>
  );
}
