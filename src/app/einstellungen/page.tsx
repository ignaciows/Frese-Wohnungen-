import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import {
  getSharingSettings,
  getSourceRecheckSettings,
  getSystemTransferSettings,
} from '@/server/settings';
import {
  saveSharingSettingsAction,
  saveRecheckSettingsAction,
  saveTransferSettingsAction,
} from '@/app/actions';
import { AppBar, Callout } from '@/app/_components/Shell';
import { prisma } from '@/lib/prisma';
import { readMailConfig } from '@/server/mailIngest';
import { runMailIngestAction } from '@/app/actions';
import { formatDateTime } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const isAdmin = user.role === 'ADMIN';

  const [sharing, recheck, transfer, recentIngests] = await Promise.all([
    getSharingSettings(),
    getSourceRecheckSettings(),
    getSystemTransferSettings(),
    prisma.emailIngestLog.findMany({ orderBy: { receivedAt: 'desc' }, take: 8 }),
  ]);
  const mailConfigured = readMailConfig() != null;

  return (
    <>
      <AppBar user={user} />
      <main className="container page" style={{ maxWidth: 820 }}>
        <div className="page-title" style={{ marginBottom: 20 }}>
          <h1>Einstellungen</h1>
          <span className="sub">
            Regeln, die das Verhalten der App steuern — änderbar ohne neue Softwareversion.
          </span>
        </div>

        {!isAdmin ? (
          <Callout tone="warning">
            Nur Admins können diese Einstellungen ändern. Du siehst die aktuellen Werte.
          </Callout>
        ) : null}

        {/* ------------------------------------------------ WG matching --- */}
        <form action={saveSharingSettingsAction} className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>WG-Matching</h2>
          </div>
          <div className="card-body stack">
            <div className="checkline">
              <input
                id="enabled"
                name="enabled"
                type="checkbox"
                value="true"
                defaultChecked={sharing.enabled}
                disabled={!isAdmin}
              />
              <label htmlFor="enabled">WG-Vorschläge aktiv</label>
            </div>

            <div className="grid-2">
              <div>
                <label htmlFor="maxMoveInGapDays">Maximaler Abstand der Einzugstermine (Tage)</label>
                <input
                  id="maxMoveInGapDays"
                  name="maxMoveInGapDays"
                  type="number"
                  min={1}
                  max={180}
                  className="input"
                  defaultValue={sharing.maxMoveInGapDays}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <label htmlFor="minScore">Mindestpunktzahl für einen Vorschlag</label>
                <input
                  id="minScore"
                  name="minScore"
                  type="number"
                  min={0}
                  max={100}
                  className="input"
                  defaultValue={sharing.minScore}
                  disabled={!isAdmin}
                />
              </div>
            </div>

            <div>
              <label htmlFor="nationalityRule">Regel zur Herkunft</label>
              <select
                id="nationalityRule"
                name="nationalityRule"
                className="select"
                defaultValue={sharing.nationalityRule}
                disabled={!isAdmin}
              >
                <option value="IGNORE">Herkunft nicht berücksichtigen</option>
                <option value="PREFER_SAME">Gleiche Herkunft bevorzugen (Bonuspunkte)</option>
                <option value="SAME_ONLY">Nur gleiche Herkunft vorschlagen</option>
              </select>
              <p className="field-hint">
                Betrifft ausschließlich die Reihenfolge interner Vorschläge. Prüfe vor „Nur gleiche
                Herkunft“, ob das mit euren Gleichbehandlungs-Richtlinien vereinbar ist — siehe
                docs/PRIVACY_AND_SECURITY.md.
              </p>
            </div>

            <div className="checkline">
              <input
                id="requireSameRegion"
                name="requireSameRegion"
                type="checkbox"
                value="true"
                defaultChecked={sharing.requireSameRegion}
                disabled={!isAdmin}
              />
              <label htmlFor="requireSameRegion">Nur Kandidaten aus derselben Region paaren</label>
            </div>
            <div className="checkline">
              <input
                id="considerLanguages"
                name="considerLanguages"
                type="checkbox"
                value="true"
                defaultChecked={sharing.considerLanguages}
                disabled={!isAdmin}
              />
              <label htmlFor="considerLanguages">Gemeinsame Sprache als Pluspunkt werten</label>
            </div>
          </div>
          {isAdmin ? (
            <div className="card-foot row-between">
              <span className="small muted">Vorschläge werden nach dem Speichern neu berechnet.</span>
              <button type="submit" className="btn primary">
                Speichern
              </button>
            </div>
          ) : null}
        </form>

        {/* --------------------------------------------- source recheck --- */}
        <form action={saveRecheckSettingsAction} className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Quellen-Wiedervorlage</h2>
          </div>
          <div className="card-body stack">
            <div>
              <label htmlFor="recheckAfterDays">Quelle nach wie vielen Tagen erneut prüfen?</label>
              <input
                id="recheckAfterDays"
                name="recheckAfterDays"
                type="number"
                min={1}
                max={60}
                className="input"
                style={{ maxWidth: 160 }}
                defaultValue={recheck.recheckAfterDays}
                disabled={!isAdmin}
              />
              <p className="field-hint">
                Auf Portalen erscheinen laufend neue Anzeigen. Nach dieser Frist markiert die App eine
                bereits geprüfte Quelle wieder als fällig.
              </p>
            </div>
            <div className="checkline">
              <input
                id="highlightNeverChecked"
                name="highlightNeverChecked"
                type="checkbox"
                value="true"
                defaultChecked={recheck.highlightNeverChecked}
                disabled={!isAdmin}
              />
              <label htmlFor="highlightNeverChecked">Nie geprüfte Quellen hervorheben</label>
            </div>
          </div>
          {isAdmin ? (
            <div className="card-foot" style={{ textAlign: 'right' }}>
              <button type="submit" className="btn primary">
                Speichern
              </button>
            </div>
          ) : null}
        </form>

        {/* ---------------------------------------------- mail ingest --- */}
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Suchagent-Postfach</h2>
            {mailConfigured ? (
              <span className="badge success">✓ Verbunden</span>
            ) : (
              <span className="badge">Nicht konfiguriert</span>
            )}
          </div>
          <div className="card-body stack">
            <p className="small muted">
              Portale schicken ihre Suchagent-Mails an ein gemeinsames Postfach. Die App liest es aus und legt
              die neuen Anzeigen automatisch beim richtigen Kandidaten an. Kein Scraping, keine
              Portal-Passwörter in dieser App.
            </p>

            <div className="callout">
              <span className="callout-icon" aria-hidden>
                i
              </span>
              <div>
                <strong>So richtest du eine Quelle für einen Kandidaten ein:</strong>
                <ol style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
                  <li>Im Portal mit dem eigenen Konto eine Suche speichern.</li>
                  <li>
                    Als Empfänger der Benachrichtigung die Adresse mit Kandidaten-Kennung eintragen, z. B.{' '}
                    <span className="mono">wohnungen+CAND-2026-014@…</span>
                  </li>
                  <li>Fertig — neue Treffer landen automatisch bei diesem Kandidaten.</li>
                </ol>
              </div>
            </div>

            {recentIngests.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Empfangen</th>
                      <th>Betreff</th>
                      <th>Quelle</th>
                      <th>Neu</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentIngests.map((r) => (
                      <tr key={r.id}>
                        <td className="small nowrap">{formatDateTime(r.receivedAt)}</td>
                        <td className="small">{r.subject || '—'}</td>
                        <td className="small">{r.sourceKey ?? '—'}</td>
                        <td>{r.listingsCreated}</td>
                        <td>
                          <span className={`badge ${r.status === 'PROCESSED' ? 'success' : 'warning'}`}>
                            {r.status}
                          </span>
                          {r.note ? <div className="small subtle">{r.note}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="small subtle">Noch keine Mails verarbeitet.</p>
            )}
          </div>
          {isAdmin && mailConfigured ? (
            <div className="card-foot" style={{ textAlign: 'right' }}>
              <form action={runMailIngestAction}>
                <button type="submit" className="btn primary">
                  Postfach jetzt abrufen
                </button>
              </form>
            </div>
          ) : null}
        </div>

        {/* ------------------------------------------- transfer labels --- */}
        <form action={saveTransferSettingsAction} className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Feldnamen für das Firmen-System</h2>
          </div>
          <div className="card-body grid-3">
            <div>
              <label htmlFor="objectLabel">Feld 1</label>
              <input
                id="objectLabel"
                name="objectLabel"
                className="input"
                defaultValue={transfer.objectLabel}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <label htmlFor="linkLabel">Feld 2</label>
              <input
                id="linkLabel"
                name="linkLabel"
                className="input"
                defaultValue={transfer.linkLabel}
                disabled={!isAdmin}
              />
            </div>
            <div>
              <label htmlFor="locationLabel">Feld 3</label>
              <input
                id="locationLabel"
                name="locationLabel"
                className="input"
                defaultValue={transfer.locationLabel}
                disabled={!isAdmin}
              />
            </div>
          </div>
          {isAdmin ? (
            <div className="card-foot row-between">
              <span className="small muted">
                Reine Beschriftung des Kopier-Panels. Es gibt bewusst keine API-Verbindung zum
                Firmen-System.
              </span>
              <button type="submit" className="btn primary">
                Speichern
              </button>
            </div>
          ) : null}
        </form>
      </main>
    </>
  );
}
