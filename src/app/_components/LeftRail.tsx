import Link from 'next/link';
import {
  newSearchRunAction,
  saveMessageAction,
  saveProfileAction,
  updateSourceCheckAction,
} from '../actions';
import { ImportListingForm } from './ImportListingForm';

interface Props {
  candidate: {
    id: string;
    reference: string;
    displayName: string;
    applicationMessage: { body: string; revision: number } | null;
    searchProfile: {
      workplaceAddress: string;
      workplaceCity: string | null;
      workplacePostalCode: string | null;
      maxWarmmieteCents: number;
      minRooms: number;
      preferredRooms: number;
      adults: number;
      children: number;
      maxCommuteMinutes: number | null;
      furnished: 'REQUIRED' | 'PREFERRED' | 'EITHER';
      wbsStatus: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
      temporaryMode: boolean;
    } | null;
  };
  searchRun: {
    id: string;
    label: string;
    createdAt: Date;
    sourceChecks: Array<{
      id: string;
      status: string;
      importedCount: number;
      lastCheckedAt: Date | null;
      generatedUrl: string | null;
      inclusionReason: string;
      note: string | null;
      recipeSnapshot: unknown;
      source: { id: string; name: string; websiteUrl: string; integrationMode: string; category: string };
      checkedBy: { name: string } | null;
    }>;
  } | null;
  allSources: Array<{ id: string; name: string; key: string; integrationMode: string }>;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Offen', className: 'chip' },
  IN_PROGRESS: { label: 'In Bearbeitung', className: 'chip approximate' },
  CHECKED_NO_RESULTS: { label: 'Geprüft — nichts', className: 'chip manual' },
  CHECKED_RESULTS_IMPORTED: { label: 'Geprüft — importiert', className: 'chip exact' },
  UNAVAILABLE: { label: 'Nicht verfügbar', className: 'chip unsupported' },
  SKIPPED: { label: 'Übersprungen', className: 'chip' },
};

export function LeftRail({ candidate, searchRun, allSources }: Props) {
  const message = candidate.applicationMessage?.body ?? '';
  const p = candidate.searchProfile;

  return (
    <aside style={{ display: 'grid', gap: 12 }}>
      {/* Application message */}
      <section className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong>Anschreiben</strong>
          <span className="muted" style={{ fontSize: 11 }}>
            Rev. {candidate.applicationMessage?.revision ?? 0}
          </span>
        </div>
        <form action={saveMessageAction}>
          <input type="hidden" name="candidateCaseId" value={candidate.id} />
          <textarea name="body" className="textarea" defaultValue={message} placeholder="Anschreiben hier einfügen…" />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="submit" className="btn primary small">
              Speichern
            </button>
            <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
              Wird 1:1 in jeden Kontaktversuch übernommen.
            </span>
          </div>
        </form>
      </section>

      {/* Search profile */}
      {p ? (
        <section className="card" style={{ padding: 12 }}>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Suchprofil</summary>
            <form action={saveProfileAction} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <input type="hidden" name="candidateCaseId" value={candidate.id} />
              <div>
                <label>Arbeitsort (Adresse)</label>
                <input className="input" name="workplaceAddress" defaultValue={p.workplaceAddress} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label>PLZ</label>
                  <input className="input" name="workplacePostalCode" defaultValue={p.workplacePostalCode ?? ''} />
                </div>
                <div>
                  <label>Ort</label>
                  <input className="input" name="workplaceCity" defaultValue={p.workplaceCity ?? ''} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label>Max. Warmmiete (€)</label>
                  <input
                    className="input"
                    type="number"
                    name="maxWarmmieteEuros"
                    min={100}
                    max={10000}
                    defaultValue={Math.round(p.maxWarmmieteCents / 100)}
                  />
                </div>
                <div>
                  <label>Max. Anfahrt (min)</label>
                  <input
                    className="input"
                    type="number"
                    name="maxCommuteMinutes"
                    min={1}
                    max={240}
                    defaultValue={p.maxCommuteMinutes ?? 35}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label>Min. Zimmer</label>
                  <input
                    className="input"
                    type="number"
                    step="0.5"
                    name="minRooms"
                    defaultValue={p.minRooms}
                  />
                </div>
                <div>
                  <label>Wunsch-Zimmer</label>
                  <input
                    className="input"
                    type="number"
                    step="0.5"
                    name="preferredRooms"
                    defaultValue={p.preferredRooms}
                  />
                </div>
              </div>
              <div>
                <label>Möbliert</label>
                <select className="input" name="furnished" defaultValue={p.furnished}>
                  <option value="REQUIRED">Erforderlich</option>
                  <option value="PREFERRED">Bevorzugt</option>
                  <option value="EITHER">Egal</option>
                </select>
              </div>
              <div>
                <label>WBS</label>
                <select className="input" name="wbsStatus" defaultValue={p.wbsStatus}>
                  <option value="UNKNOWN">Unbekannt</option>
                  <option value="AVAILABLE">Vorhanden</option>
                  <option value="NOT_AVAILABLE">Nicht vorhanden</option>
                </select>
              </div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" name="temporaryMode" defaultChecked={p.temporaryMode} />
                <span>Notfall-Modus (temporäres Wohnen zulassen)</span>
              </label>
              <button type="submit" className="btn small primary">
                Profil speichern & neu ranken
              </button>
            </form>
          </details>
        </section>
      ) : null}

      {/* Source checklist */}
      <section className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong>Quellen-Checkliste</strong>
          {searchRun ? (
            <span className="muted" style={{ fontSize: 11 }}>
              {searchRun.sourceChecks.length} Aufgaben · {searchRun.label}
            </span>
          ) : (
            <form action={newSearchRunAction}>
              <input type="hidden" name="candidateCaseId" value={candidate.id} />
              <button type="submit" className="btn small primary">
                Suchlauf starten
              </button>
            </form>
          )}
        </div>
        {searchRun ? (
          <div style={{ display: 'grid', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
            {searchRun.sourceChecks.map((sc) => {
              const stat = STATUS_LABEL[sc.status] ?? STATUS_LABEL.PENDING;
              return (
                <div
                  key={sc.id}
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 6,
                    display: 'grid',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <div>
                      <strong style={{ fontSize: 13 }}>{sc.source.name}</strong>
                      <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>
                        · {sc.source.integrationMode.replace('_', ' ')}
                      </span>
                    </div>
                    <span className={stat.className} style={{ fontSize: 11 }}>
                      {stat.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <a
                      href={sc.generatedUrl ?? sc.source.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn small"
                    >
                      Öffnen
                    </a>
                    <form action={updateSourceCheckAction}>
                      <input type="hidden" name="sourceCheckId" value={sc.id} />
                      <input type="hidden" name="status" value="CHECKED_NO_RESULTS" />
                      <button type="submit" className="btn small">
                        Nichts gefunden
                      </button>
                    </form>
                    <form action={updateSourceCheckAction}>
                      <input type="hidden" name="sourceCheckId" value={sc.id} />
                      <input type="hidden" name="status" value="CHECKED_RESULTS_IMPORTED" />
                      <button type="submit" className="btn small">
                        Erledigt
                      </button>
                    </form>
                    <details style={{ marginLeft: 'auto' }}>
                      <summary
                        style={{
                          cursor: 'pointer',
                          fontSize: 11,
                          color: 'var(--muted)',
                        }}
                      >
                        Rezept
                      </summary>
                      <RecipeView recipe={sc.recipeSnapshot} />
                    </details>
                  </div>
                  {sc.note ? <div className="muted" style={{ fontSize: 11 }}>Notiz: {sc.note}</div> : null}
                  {sc.checkedBy ? (
                    <div className="muted" style={{ fontSize: 11 }}>
                      geprüft von {sc.checkedBy.name}
                      {sc.lastCheckedAt ? ` · ${sc.lastCheckedAt.toLocaleString('de-DE')}` : ''}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12 }}>
            Noch kein Suchlauf gestartet.
          </p>
        )}
        {searchRun ? (
          <form action={newSearchRunAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="candidateCaseId" value={candidate.id} />
            <button type="submit" className="btn small">
              + Neuer Suchlauf
            </button>
          </form>
        ) : null}
      </section>

      {/* Manual import */}
      <section className="card" style={{ padding: 12 }}>
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Anzeige manuell importieren</summary>
          <div style={{ marginTop: 8 }}>
            <ImportListingForm sources={allSources} />
          </div>
        </details>
      </section>

      <div className="muted" style={{ fontSize: 11, padding: '0 4px' }}>
        <Link href="/sources">Quellenkatalog verwalten →</Link>
      </div>
    </aside>
  );
}

function RecipeView({ recipe }: { recipe: unknown }) {
  const r = recipe as { headline?: string; lines?: Array<{ label: string; humanValue: string; quality: string; advice: string }> };
  if (!r?.lines) return null;
  return (
    <div style={{ padding: 8, fontSize: 12 }}>
      {r.headline ? <div className="muted" style={{ marginBottom: 6 }}>{r.headline}</div> : null}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {r.lines.map((line, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '2px 4px', width: '30%' }}>{line.label}</td>
              <td style={{ padding: '2px 4px' }}>{line.humanValue}</td>
              <td style={{ padding: '2px 4px' }}>
                <span className={`chip ${line.quality.toLowerCase()}`}>{line.quality}</span>
              </td>
              <td className="muted" style={{ padding: '2px 4px', fontSize: 11 }}>
                {line.advice}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
