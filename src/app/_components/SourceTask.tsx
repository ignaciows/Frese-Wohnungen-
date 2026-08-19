'use client';

import { useState } from 'react';
import { updateSourceCheckAction } from '@/app/actions';
import { MAPPING_QUALITY, SOURCE_CHECK_STATUS, SOURCE_ROUTE, relativeDays } from '@/lib/labels';
import { SubmitButton } from '@/app/_components/SubmitButton';

interface RecipeLine {
  filter: string;
  label: string;
  quality: string;
  portalLabel: string | null;
  humanValue: string;
  advice: string;
}

export interface SourceTaskData {
  id: string;
  status: string;
  importedCount: number;
  lastCheckedAt: string | null;
  checkedByName: string | null;
  note: string | null;
  source: {
    id: string;
    name: string;
    websiteUrl: string;
    /** DISCOVERY | EMAIL_ALERT — see Source.route. */
    route: string;
    /** Portal-specific hints from the catalogue, e.g. how to save the search. */
    manualRecipe: string | null;
  };
  recipe: { headline: string; lines: RecipeLine[] };
}

export function SourceTask({
  task,
  onImport,
}: {
  task: SourceTaskData;
  onImport: (sourceId: string, sourceName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const status = SOURCE_CHECK_STATUS[task.status] ?? SOURCE_CHECK_STATUS.PENDING;
  const route = SOURCE_ROUTE[task.source.route] ?? { label: task.source.route, hint: '', tone: 'neutral' };
  const done = task.status === 'CHECKED_NO_RESULTS' || task.status === 'CHECKED_RESULTS_IMPORTED';

  // Filters the portal cannot apply — the colleague must check these by hand.
  const manualLines = task.recipe.lines.filter(
    (l) => l.quality === 'MANUAL' || l.quality === 'UNSUPPORTED',
  );

  return (
    <div className="card" style={done ? { opacity: 0.72 } : undefined}>
      <div className="card-pad">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="grow stack-sm">
            <div className="row-wrap">
              <h3>{task.source.name}</h3>
              <span className={`badge ${status.tone}`}>
                {status.icon} {status.label}
              </span>
              <span className={`badge ${route.tone}`}>{route.label}</span>
              {task.importedCount > 0 ? (
                <span className="badge brand">{task.importedCount} importiert</span>
              ) : null}
            </div>
            <div className="small muted">
              {task.lastCheckedAt
                ? `Zuletzt geprüft ${relativeDays(task.lastCheckedAt)}${
                    task.checkedByName ? ` von ${task.checkedByName}` : ''
                  }`
                : route.hint}
            </div>
            {manualLines.length > 0 && !done ? (
              <div className="small" style={{ color: 'var(--warning)' }}>
                Im Text prüfen: {manualLines.map((l) => l.label).join(', ')}
              </div>
            ) : null}
            {task.note ? <div className="small subtle">Notiz: {task.note}</div> : null}
          </div>

          <div className="row" style={{ flexShrink: 0 }}>
            <a
              href={task.source.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn primary sm"
              title="Portal öffnen"
            >
              Öffnen ↗
            </a>
            <button type="button" className="btn sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? 'Weniger' : 'Anleitung'}
            </button>
          </div>
        </div>

        {open ? (
          <div className="stack" style={{ marginTop: 16 }}>
            <hr className="divider" />
            <div>
              <h4 style={{ marginBottom: 8 }}>So suchst du auf dieser Quelle</h4>
              <p className="small muted" style={{ marginBottom: 10 }}>
                {task.recipe.headline}
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Kriterium</th>
                      <th>Wert eintragen</th>
                      <th>Portal kann das</th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.recipe.lines.map((l) => {
                      const q = MAPPING_QUALITY[l.quality] ?? MAPPING_QUALITY.UNKNOWN;
                      return (
                        <tr key={l.filter}>
                          <td>
                            <strong>{l.label}</strong>
                            {l.portalLabel ? (
                              <div className="small subtle">Portal nennt es „{l.portalLabel}“</div>
                            ) : null}
                          </td>
                          <td>
                            {l.humanValue}
                            {l.advice ? <div className="small muted">{l.advice}</div> : null}
                          </td>
                          <td>
                            <span className={`badge ${q.tone}`}>{q.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {task.source.manualRecipe ? (
                <p className="small muted" style={{ marginTop: 10 }}>
                  {task.source.manualRecipe}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="row-wrap" style={{ marginTop: 14, gap: 8 }}>
          <button
            type="button"
            className="btn soft sm"
            onClick={() => onImport(task.source.id, task.source.name)}
          >
            + Anzeige von hier importieren
          </button>
          <form action={updateSourceCheckAction}>
            <input type="hidden" name="sourceCheckId" value={task.id} />
            <input type="hidden" name="status" value="CHECKED_NO_RESULTS" />
            <SubmitButton className="btn sm">
              Geprüft — nichts gefunden
            </SubmitButton>
          </form>
          {task.status !== 'UNAVAILABLE' ? (
            <form action={updateSourceCheckAction}>
              <input type="hidden" name="sourceCheckId" value={task.id} />
              <input type="hidden" name="status" value="UNAVAILABLE" />
              <input type="hidden" name="note" value="Portal aktuell nicht erreichbar" />
              <SubmitButton className="btn ghost sm">
                Nicht erreichbar
              </SubmitButton>
            </form>
          ) : null}
          {done ? (
            <form action={updateSourceCheckAction}>
              <input type="hidden" name="sourceCheckId" value={task.id} />
              <input type="hidden" name="status" value="PENDING" />
              <SubmitButton className="btn ghost sm">
                Zurücksetzen
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
