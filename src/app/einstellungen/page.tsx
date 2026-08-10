import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import {
  getSharingSettings,
  getSourceRecheckSettings,
  getSystemTransferSettings,
  getFreshnessSettings,
  getBridgingSettings,
  getLivenessSettings,
  getTelegramSettings,
} from '@/server/settings';
import {
  saveSharingSettingsAction,
  saveRecheckSettingsAction,
  saveTransferSettingsAction,
  saveFreshnessSettingsAction,
  saveBridgingSettingsAction,
  saveLivenessSettingsAction,
  runLivenessSweepAction,
  saveTelegramSettingsAction,
  sendTelegramTestAction,
} from '@/app/actions';
import { AppBar, Callout } from '@/app/_components/Shell';
import { prisma } from '@/lib/prisma';
import { readMailConfig } from '@/server/mailIngest';
import { isTelegramConfigured } from '@/server/telegram';
import { runMailIngestAction } from '@/app/actions';
import { formatDateTime } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const isAdmin = user.role === 'ADMIN';

  const [sharing, recheck, transfer, recentIngests, freshness, bridging, liveness, telegram] =
    await Promise.all([
    getSharingSettings(),
    getSourceRecheckSettings(),
    getSystemTransferSettings(),
    prisma.emailIngestLog.findMany({ orderBy: { receivedAt: 'desc' }, take: 8 }),
    getFreshnessSettings(),
    getBridgingSettings(),
    getLivenessSettings(),
    getTelegramSettings(),
  ]);
  const mailConfigured = readMailConfig() != null;
  const telegramConfigured = isTelegramConfigured();

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

        {/* ------------------------------------------------ freshness --- */}
        <form action={saveFreshnessSettingsAction} className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Aktualität der Anzeigen</h2>
          </div>
          <div className="card-body stack">
            <div className="grid-2">
              <div>
                <label htmlFor="newWithinHours">„Neu“-Markierung bis (Stunden)</label>
                <input
                  id="newWithinHours"
                  name="newWithinHours"
                  type="number"
                  min={1}
                  max={168}
                  className="input"
                  defaultValue={freshness.newWithinHours}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <label htmlFor="staleAfterDays">Als veraltet markieren nach (Tagen)</label>
                <input
                  id="staleAfterDays"
                  name="staleAfterDays"
                  type="number"
                  min={1}
                  max={120}
                  className="input"
                  defaultValue={freshness.staleAfterDays}
                  disabled={!isAdmin}
                />
              </div>
            </div>
            <div className="checkline">
              <input
                id="hideExpired"
                name="hideExpired"
                type="checkbox"
                value="true"
                defaultChecked={freshness.hideExpired}
                disabled={!isAdmin}
              />
              <label htmlFor="hideExpired">Abgelaufene Anzeigen aus der Arbeitsliste ausblenden</label>
            </div>
            <p className="field-hint">
              Abgelaufene Anzeigen verschwinden nicht aus der Datenbank — sie stehen im eigenen Reiter
              „Abgelaufen“, damit Kontakt- und Verlaufsdaten erhalten bleiben.
            </p>
          </div>
          {isAdmin ? (
            <div className="card-foot" style={{ textAlign: 'right' }}>
              <button type="submit" className="btn primary">Speichern</button>
            </div>
          ) : null}
        </form>

        {/* ------------------------------------------------- bridging --- */}
        <form action={saveBridgingSettingsAction} className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Zwischenunterkunft (Überbrückung)</h2>
          </div>
          <div className="card-body stack">
            <p className="small muted">
              Wenn eine gute Wohnung erst nach der Ankunft frei wird, rechnet die App die Lücke in Euro um —
              statt die Wohnung stillschweigend auszusortieren.
            </p>
            <div className="grid-3">
              <div>
                <label htmlFor="nightlyRateEuros">Preis pro Nacht (€)</label>
                <input
                  id="nightlyRateEuros"
                  name="nightlyRateEuros"
                  type="number"
                  min={10}
                  max={500}
                  className="input"
                  defaultValue={Math.round(bridging.nightlyRateCents / 100)}
                  disabled={!isAdmin}
                />
                <p className="field-hint">Airbnb / Monteurzimmer</p>
              </div>
              <div>
                <label htmlFor="maxBridgeNights">Maximal sinnvolle Nächte</label>
                <input
                  id="maxBridgeNights"
                  name="maxBridgeNights"
                  type="number"
                  min={1}
                  max={180}
                  className="input"
                  defaultValue={bridging.maxBridgeNights}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <label htmlFor="idealLeadDays">Ideale Vorlaufzeit (Tage)</label>
                <input
                  id="idealLeadDays"
                  name="idealLeadDays"
                  type="number"
                  min={0}
                  max={90}
                  className="input"
                  defaultValue={bridging.idealLeadDays}
                  disabled={!isAdmin}
                />
                <p className="field-hint">Frei vor Ankunft = ideal</p>
              </div>
            </div>
          </div>
          {isAdmin ? (
            <div className="card-foot" style={{ textAlign: 'right' }}>
              <button type="submit" className="btn primary">Speichern</button>
            </div>
          ) : null}
        </form>

        {/* ------------------------------------------ link liveness --- */}
        <form action={saveLivenessSettingsAction} className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Automatische Link-Prüfung</h2>
            {liveness.enabled ? <span className="badge success">aktiv</span> : <span className="badge">aus</span>}
          </div>
          <div className="card-body stack">
            <p className="small muted">
              Die App ruft in Abständen die bereits importierten Anzeigen auf und prüft nur, ob die Seite noch
              existiert. Tote Anzeigen wandern automatisch in den Reiter „Abgelaufen“, damit niemand mehr auf
              ein totes Inserat klickt.
            </p>
            <div className="checkline">
              <input
                id="livenessEnabled"
                name="enabled"
                type="checkbox"
                value="true"
                defaultChecked={liveness.enabled}
                disabled={!isAdmin}
              />
              <label htmlFor="livenessEnabled">Link-Prüfung aktiv</label>
            </div>
            <div className="grid-3">
              <div>
                <label htmlFor="checkIntervalHours">Prüfintervall (Stunden)</label>
                <input
                  id="checkIntervalHours"
                  name="checkIntervalHours"
                  type="number"
                  min={1}
                  max={168}
                  className="input"
                  defaultValue={liveness.checkIntervalHours}
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <label htmlFor="expireAfterConsecutiveGone">Abgelaufen nach x Treffern</label>
                <input
                  id="expireAfterConsecutiveGone"
                  name="expireAfterConsecutiveGone"
                  type="number"
                  min={1}
                  max={5}
                  className="input"
                  defaultValue={liveness.expireAfterConsecutiveGone}
                  disabled={!isAdmin}
                />
                <p className="field-hint">Nur eindeutige Treffer zählen</p>
              </div>
              <div>
                <label htmlFor="maxPerRun">Max. Anzeigen pro Lauf</label>
                <input
                  id="maxPerRun"
                  name="maxPerRun"
                  type="number"
                  min={1}
                  max={500}
                  className="input"
                  defaultValue={liveness.maxPerRun}
                  disabled={!isAdmin}
                />
              </div>
            </div>
            <div>
              <label htmlFor="perHostDelayMs">Pause zwischen Abrufen desselben Portals (ms)</label>
              <input
                id="perHostDelayMs"
                name="perHostDelayMs"
                type="number"
                min={500}
                max={30000}
                step={500}
                className="input"
                style={{ maxWidth: 200 }}
                defaultValue={liveness.perHostDelayMs}
                disabled={!isAdmin}
              />
              <p className="field-hint">
                Höflichkeit gegenüber den Portalen — nicht kleiner als nötig einstellen.
              </p>
            </div>
            <div className="callout">
              <span className="callout-icon" aria-hidden>i</span>
              <div>
                Blockiert ein Portal den Abruf oder antwortet es nicht, gilt das Ergebnis als{' '}
                <strong>unklar</strong> — die Anzeige bleibt unverändert. Automatisch abgelaufen wird nur bei
                eindeutigen Treffern (404/410 oder „nicht mehr verfügbar“), und erst nach mehreren Läufen.
              </div>
            </div>
          </div>
          {isAdmin ? (
            <div className="card-foot row-between">
              <button type="submit" className="btn primary">Speichern</button>
            </div>
          ) : null}
        </form>

        {isAdmin ? (
          <form action={runLivenessSweepAction} style={{ marginTop: 8, textAlign: 'right' }}>
            <button type="submit" className="btn">Alle fälligen Anzeigen jetzt prüfen</button>
          </form>
        ) : null}

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

        {/* -------------------------------------------------- telegram --- */}
        <form action={saveTelegramSettingsAction} className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Telegram</h2>
            {telegramConfigured ? (
              <span className="badge success">✓ Verbunden</span>
            ) : (
              <span className="badge">Nicht konfiguriert</span>
            )}
          </div>
          <div className="card-body stack">
            <p className="small muted">
              Benachrichtigungen in eine Team-Gruppe, damit niemand die App den ganzen Tag beobachten muss.
              Aus der Gruppe heraus gehen <span className="mono">/status</span> und{' '}
              <span className="mono">/notiz REF Text</span>.
            </p>

            {!telegramConfigured ? (
              <div className="callout">
                <span className="callout-icon" aria-hidden>i</span>
                <div className="small">
                  Zum Aktivieren <span className="mono">TELEGRAM_BOT_TOKEN</span>,{' '}
                  <span className="mono">TELEGRAM_CHAT_ID</span> und{' '}
                  <span className="mono">TELEGRAM_WEBHOOK_SECRET</span> setzen — siehe
                  docs/TELEGRAM.md.
                </div>
              </div>
            ) : null}

            <div className="checkline">
              <input
                id="tgEnabled"
                name="enabled"
                type="checkbox"
                value="true"
                defaultChecked={telegram.enabled}
                disabled={!isAdmin}
              />
              <label htmlFor="tgEnabled">Benachrichtigungen aktiv</label>
            </div>
            <div className="checkline">
              <input id="tgReply" name="onReply" type="checkbox" value="true" defaultChecked={telegram.onReply} disabled={!isAdmin} />
              <label htmlFor="tgReply">Wenn ein Vermieter antwortet</label>
            </div>
            <div className="checkline">
              <input id="tgPos" name="onPositive" type="checkbox" value="true" defaultChecked={telegram.onPositive} disabled={!isAdmin} />
              <label htmlFor="tgPos">Bei positiver Rückmeldung</label>
            </div>
            <div className="checkline">
              <input id="tgNew" name="onNewListings" type="checkbox" value="true" defaultChecked={telegram.onNewListings} disabled={!isAdmin} />
              <label htmlFor="tgNew">Bei neuen Anzeigen aus dem Suchagent-Postfach</label>
            </div>
            <div className="checkline">
              <input id="tgDue" name="onFollowUpDue" type="checkbox" value="true" defaultChecked={telegram.onFollowUpDue} disabled={!isAdmin} />
              <label htmlFor="tgDue">Tagesübersicht (fällige Wiedervorlagen &amp; Termine)</label>
            </div>
          </div>
          {isAdmin ? (
            <div className="card-foot row-between">
              <span className="small muted">Nur der konfigurierte Chat darf den Bot bedienen.</span>
              <button type="submit" className="btn primary">Speichern</button>
            </div>
          ) : null}
        </form>

        {isAdmin && telegramConfigured ? (
          <form action={sendTelegramTestAction} style={{ marginTop: 8, textAlign: 'right' }}>
            <button type="submit" className="btn">Testnachricht senden</button>
          </form>
        ) : null}

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
