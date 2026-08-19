import { redirect } from 'next/navigation';
import { inboxCounts } from '@/server/followUps';
import { currentUser } from '@/lib/auth';
import {
  getDiscoverySettings,
  getOutboundSettings,
  getFollowUpSettings,
  getSharingSettings,
  getSourceRecheckSettings,
  getSystemTransferSettings,
  getFreshnessSettings,
  getBridgingSettings,
  getLivenessSettings,
  getAgeFilterSettings,
  getQualitySettings,
  getMailboxSettings,
  getTelegramSettings,
  getFeatureSettings,
} from '@/server/settings';
import {
  saveSharingSettingsAction,
  saveRecheckSettingsAction,
  saveTransferSettingsAction,
  saveFreshnessSettingsAction,
  saveBridgingSettingsAction,
  saveLivenessSettingsAction,
  saveAgeFilterSettingsAction,
  saveQualitySettingsAction,
  saveMailboxSettingsAction,
  runLivenessSweepAction,
  saveTelegramSettingsAction,
  sendTelegramTestAction,
} from '@/app/actions';
import { AppBar, Callout } from '@/app/_components/Shell';
import { prisma } from '@/lib/prisma';
import { readMailConfigFromEnv } from '@/server/mailIngest';
import { isTelegramConfigured } from '@/server/telegram';
import { runMailIngestAction } from '@/app/actions';
import { formatDateTime } from '@/lib/labels';
import { anyMailboxConfigured, listAccounts } from '@/server/portalAccounts';
import { credentialKeyConfigured } from '@/lib/crypto';
import { AccountsSection, DiscoveryRunsSection, DiscoverySection, FeaturesSection } from './_sections';
import { googleMailboxEnabled } from '@/lib/googleMailbox';

export const dynamic = 'force-dynamic';

/**
 * Feste Rückmeldungen, angesprochen über ein Kürzel.
 *
 * Was hier kein Kürzel ist, kommt unverändert durch — die Prüfung eines
 * Postfachs meldet „Empfangen (IMAP imap.gmail.com): timeout", und so ein Satz
 * lässt sich nicht vorher aufschreiben. Für die Anmeldeseite war freier Text
 * aus der Adresse ein echtes Problem (dort wird gleich ein Passwort
 * eingetippt); hier steht er hinter einer Anmeldung und vor einem Publikum,
 * das den Bildschirm kennt. Wer das enger ziehen will, braucht einen
 * Flash-Speicher in der Sitzung — die Rückmeldung darf dann gar nicht mehr in
 * der Adresse stehen.
 */
const EINSTELLUNGEN_MELDUNGEN: Record<string, string> = {
  konto: 'Zugang gespeichert.',
  quelle: 'Quelle gespeichert.',
  'google-postfach': 'Postfach verbunden — Senden und Empfangen geprüft.',
  'google-postfach-pruefung':
    'Postfach verbunden, aber die erste Anmeldung hat nicht geklappt. Einmal auf „Prüfen“ — bleibt es dabei, muss in Google IMAP freigeschaltet werden.',
  'google-postfach-abgebrochen': 'Die Verbindung mit Google wurde abgebrochen.',
  'google-postfach-abgelaufen': 'Der Verbindungsversuch ist abgelaufen. Bitte noch einmal starten.',
  'google-postfach-fehlgeschlagen':
    'Google hat den Zugriff nicht erteilt. Bitte noch einmal versuchen — hilft das nicht, im Google-Konto unter „Drittanbieter-Zugriff“ den Zugriff dieser App entfernen.',
  'google-postfach-speichern': 'Das Postfach ließ sich nicht speichern. Steht CREDENTIAL_KEY auf dem Server?',
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string; gespeichert?: string; portal?: string }>;
}) {
  const feedback = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login');
  const pending = await inboxCounts();
  const isAdmin = user.role === 'ADMIN';

  const [
    sharing,
    recheck,
    transfer,
    recentIngests,
    freshness,
    bridging,
    liveness,
    ageFilter,
    quality,
    mailbox,
    telegram,
    discovery,
    features,
    outbound,
    followUp,
    accounts,
    discoverySources,
    discoveryRuns,
  ] = await Promise.all([
    getSharingSettings(),
    getSourceRecheckSettings(),
    getSystemTransferSettings(),
    prisma.emailIngestLog.findMany({ orderBy: { receivedAt: 'desc' }, take: 8 }),
    getFreshnessSettings(),
    getBridgingSettings(),
    getLivenessSettings(),
    getAgeFilterSettings(),
    getQualitySettings(),
    getMailboxSettings(),
    getTelegramSettings(),
    getDiscoverySettings(),
    getFeatureSettings(),
    getOutboundSettings(),
    getFollowUpSettings(),
    listAccounts(),
    prisma.source.findMany({
      where: { active: true },
      orderBy: [{ discoveryEnabled: 'desc' }, { priority: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        websiteUrl: true,
        route: true,
        discoveryAdapter: true,
        discoveryEnabled: true,
        discoveryConfig: true,
        discoveryStatus: true,
        discoveryNote: true,
        lastDiscoveredAt: true,
        pollIntervalMinutes: true,
      },
    }),
    prisma.discoveryRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 12,
      include: { source: { select: { name: true } } },
    }),
  ]);
  // Nur die Frage „ist eingerichtet", und die kostet eine Zählung. Vorher
  // stand hier `readMailConfig()`, was seit den Google-Postfächern bei jedem
  // Seitenaufbau ein Token erneuert hat — und bei einer Google-Störung stand
  // dann „nicht konfiguriert" über einem funktionierenden Postfach.
  const mailConfigured =
    (await anyMailboxConfigured()) || readMailConfigFromEnv() != null;
  const credentialKeyOk = credentialKeyConfigured();
  const telegramConfigured = isTelegramConfigured();

  return (
    <>
      <AppBar user={user} active="einstellungen" pending={pending.dueTasks + pending.unreadReplies} />
      <main className="container page" style={{ maxWidth: 820 }}>
        <div className="page-title" style={{ marginBottom: 14 }}>
          <h1>Einstellungen</h1>
          <span className="sub">
            Regeln, die das Verhalten der App steuern — änderbar ohne neue Softwareversion.
          </span>
        </div>

        {/* A page this long needs a way in. Somebody looking for "wo trage ich
            das Kleinanzeigen-Konto ein" was scrolling past twelve cards of
            thresholds and weights to find out whether the thing they wanted was
            even on the page. */}
        <nav className="jumpnav" aria-label="Abschnitte">
          <span className="jumpnav-label">Springe zu:</span>
          <a href="#suche">Automatische Suche</a>
          <a href="#quellen">Quellen</a>
          <a href="#konten">Konten &amp; Passwörter</a>
          <a href="#versand">Versand</a>
          <a href="#suchagent">Suchagent-Postfach</a>
        </nav>

        {feedback.fehler ? (
          <Callout tone="danger">{EINSTELLUNGEN_MELDUNGEN[feedback.fehler] ?? feedback.fehler}</Callout>
        ) : null}
        {feedback.gespeichert ? (
          <Callout tone="success">
            {EINSTELLUNGEN_MELDUNGEN[feedback.gespeichert] ?? feedback.gespeichert}
          </Callout>
        ) : null}

        {!isAdmin ? (
          <Callout tone="warning">
            Nur Admins können diese Einstellungen ändern. Du siehst die aktuellen Werte.
          </Callout>
        ) : null}

        <DiscoverySection
          settings={discovery}
          sources={discoverySources}
          runs={discoveryRuns.map((r) => ({
            id: r.id,
            sourceName: r.source.name,
            adapter: r.adapter,
            status: r.status,
            found: r.found,
            created: r.created,
            retired: r.retired,
            message: r.message,
            startedAt: r.startedAt,
          }))}
          isAdmin={isAdmin}
        />


        <AccountsSection
          accounts={accounts}
          outbound={outbound}
          followUp={followUp}
          isAdmin={isAdmin}
          credentialKeyOk={credentialKeyOk}
          sources={discoverySources.map((s) => ({ id: s.id, key: s.key, name: s.name }))}
          preselectPortalKey={feedback.portal ?? null}
          googleMailbox={googleMailboxEnabled()}
        />

        {/* ---------------------------------------------- mail ingest --- */}
        <div className="card" id="suchagent" style={{ marginTop: 18 }}>
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


        {/* Everything below is a knob, not a task.
            Thresholds, weights, wording, the Telegram bridge, the labels of
            the copy panel — real settings, all of them, and none of them
            something anybody touches on a normal day. Twelve cards of them
            sat between a colleague and the two things they actually came for
            ("wo trage ich das Postfach ein", "welche Quellen laufen"), so
            they are folded away now rather than deleted. */}
        <details className="card advanced" style={{ marginTop: 18 }}>
          <summary>
            <strong>Erweiterte Einstellungen</strong>
            <span className="small muted"> — Schwellenwerte, Textprüfung, Telegram, Feldnamen</span>
          </summary>
          <div className="stack">
            <FeaturesSection features={features} isAdmin={isAdmin} />
            <DiscoveryRunsSection
              runs={discoveryRuns.map((r) => ({
                id: r.id,
                sourceName: r.source.name,
                adapter: r.adapter,
                status: r.status,
                found: r.found,
                created: r.created,
                retired: r.retired,
                message: r.message,
                startedAt: r.startedAt,
              }))}
            />
          {/* ------------------------------------------- quality filter --- */}
          <form action={saveQualitySettingsAction} className="card" id="qualitaet" style={{ marginTop: 18 }}>
            <div className="card-head">
              <h2>Was ausgeschlossen wird</h2>
              <span className="sub">
                Anzeigen außerhalb dieser Grenzen kommen gar nicht erst in die Liste.
              </span>
            </div>
            <div className="card-body stack">
              <Callout tone="info">
                Jede Suche bringt Dinge zurück, die zwar Anzeigen sind, aber keine Wohnung für unsere
                Kandidaten: ein Zimmer für 100 € im Monat, eine &bdquo;Wohnung&ldquo; mit zwanzig Zimmern, ein
                Apartment für vier Wochen zur Messe. Hier steht, wo die Grenze liegt.
              </Callout>
              <div className="grid-2">
                <div>
                  <label htmlFor="minMonthlyEuros">Mindestmiete (€ / Monat)</label>
                  <input
                    id="minMonthlyEuros"
                    name="minMonthlyEuros"
                    type="number"
                    min={0}
                    max={2000}
                    className="input"
                    defaultValue={quality.minMonthlyEuros}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">Darunter ist es ein Zimmer oder ein Preis pro Nacht.</p>
                </div>
                <div>
                  <label htmlFor="maxMonthlyEuros">Höchstmiete (€ / Monat)</label>
                  <input
                    id="maxMonthlyEuros"
                    name="maxMonthlyEuros"
                    type="number"
                    min={300}
                    max={20000}
                    className="input"
                    defaultValue={quality.maxMonthlyEuros}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">
                    Absolute Obergrenze, unabhängig vom Budget des einzelnen Kandidaten.
                  </p>
                </div>
                <div>
                  <label htmlFor="maxRooms">Höchstzahl Zimmer</label>
                  <input
                    id="maxRooms"
                    name="maxRooms"
                    type="number"
                    min={1}
                    max={20}
                    className="input"
                    defaultValue={quality.maxRooms}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">Darüber ist es ein Haus, kein Wohnungsangebot.</p>
                </div>
                <div>
                  <label htmlFor="minSqm">Mindestfläche (m²)</label>
                  <input
                    id="minSqm"
                    name="minSqm"
                    type="number"
                    min={0}
                    max={100}
                    className="input"
                    defaultValue={quality.minSqm}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">0 = keine Grenze.</p>
                </div>
              </div>
              <div className="checkline">
                <input
                  id="rejectShortStay"
                  name="rejectShortStay"
                  type="checkbox"
                  value="true"
                  defaultChecked={quality.rejectShortStay}
                  disabled={!isAdmin}
                />
                <label htmlFor="rejectShortStay">
                  Wohnen auf Zeit ausschließen (Monteurzimmer, Boardinghouse, Ferienwohnung, &bdquo;pro Woche&ldquo;)
                </label>
              </div>
              <p className="field-hint">
                Erkannt wird an der Wortwahl der Anzeige, nicht am Portal: Wohnen auf Zeit steht auf
                Kleinanzeigen zwischen den normalen Wohnungen und liest sich fast genauso.
              </p>
            </div>
            {isAdmin ? (
              <div className="card-foot row-between">
                <span className="small muted">Gilt ab dem nächsten Suchlauf.</span>
                <button type="submit" className="btn primary">
                  Speichern
                </button>
              </div>
            ) : null}
          </form>

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

          {/* ------------------------------------------- age filter --- */}
          <form action={saveAgeFilterSettingsAction} className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <h2>Nur frisch inserierte Anzeigen</h2>
              {ageFilter.maxAgeDays > 0 ? (
                <span className="badge success">max. {ageFilter.maxAgeDays} Tage</span>
              ) : (
                <span className="badge">aus</span>
              )}
            </div>
            <div className="card-body stack">
              <p className="small muted">
                Blendet Anzeigen aus, die schon länger online sind. Gemessen wird — in dieser
                Reihenfolge — am <strong>Einstelldatum des Portals</strong>, ersatzweise am Eingang
                der Suchagent-Mail, und erst zuletzt daran, seit wann <em>wir</em> die Anzeige kennen.
                Nur die ersten beiden sind echte Veröffentlichungsdaten; das dritte steht deshalb als
                „seit … bekannt“ in der Liste und wird standardmäßig nicht weggefiltert.
              </p>
              <div className="grid-2">
                <div>
                  <label htmlFor="maxAgeDays">Höchstalter in Tagen (0 = aus)</label>
                  <input
                    id="maxAgeDays"
                    name="maxAgeDays"
                    type="number"
                    min={0}
                    max={365}
                    className="input"
                    defaultValue={ageFilter.maxAgeDays}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">7 Tage ist ein üblicher Wert für angespannte Märkte.</p>
                </div>
                <div className="checkline" style={{ alignItems: 'flex-start', paddingTop: 26 }}>
                  <input
                    id="hideApproximate"
                    name="hideApproximate"
                    type="checkbox"
                    value="true"
                    defaultChecked={ageFilter.hideApproximate}
                    disabled={!isAdmin}
                  />
                  <label htmlFor="hideApproximate">
                    Auch Anzeigen ohne Portal-Datum ausblenden
                  </label>
                </div>
              </div>
              <div className="callout">
                <span className="callout-icon" aria-hidden>i</span>
                <div>
                  ImmoScout24 lässt sich nicht auslesen (HTTP 401), nennt also nie ein Datum. Solche
                  Anzeigen kommen über den Suchagenten herein — dort gilt der Maileingang als
                  Veröffentlichung, was auf wenige Stunden genau stimmt.
                </div>
              </div>
            </div>
            {isAdmin ? (
              <div className="card-foot row-between">
                <button type="submit" className="btn primary">Speichern</button>
              </div>
            ) : null}
          </form>

          {/* ------------------------------------------ link liveness --- */}
          <form action={saveLivenessSettingsAction} className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <h2>Textprüfung: Ist die Anzeige noch online?</h2>
              {liveness.enabled ? <span className="badge success">aktiv</span> : <span className="badge">aus</span>}
            </div>
            <div className="card-body stack">
              <p className="small muted">
                Die App ruft eine bereits importierte Anzeige auf und <strong>liest den Seitentext</strong> —
                Formulierungen wie „Angebot nicht gefunden“ oder „bereits vermietet“, das Einstelldatum
                („Online seit …“), Preis- und Kontaktfelder. Der Status-Code allein reicht nicht: die großen
                Portale liefern eine gelöschte Anzeige als ganz normale Seite aus.
              </p>
              <p className="small muted">
                Ergebnis ist ein <strong>Prozentwert</strong>, keine Ja/Nein-Antwort. Anzeigen dazwischen
                verschwinden nicht, sondern landen im Reiter „Zu prüfen“ — die Texterkennung kann sich irren,
                und eine still ausgeblendete Wohnung sieht niemand je wieder.
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
                <label htmlFor="livenessEnabled">Textprüfung aktiv</label>
              </div>
              <div className="checkline">
                <input
                  id="checkOnSearch"
                  name="checkOnSearch"
                  type="checkbox"
                  value="true"
                  defaultChecked={liveness.checkOnSearch}
                  disabled={!isAdmin}
                />
                <label htmlFor="checkOnSearch">
                  Bei jedem Öffnen einer Ergebnisliste sofort nachprüfen
                </label>
              </div>
              <div className="checkline">
                <input
                  id="showOnlyConfirmedActive"
                  name="showOnlyConfirmedActive"
                  type="checkbox"
                  value="true"
                  defaultChecked={liveness.showOnlyConfirmedActive}
                  disabled={!isAdmin}
                />
                <label htmlFor="showOnlyConfirmedActive">
                  Nur bestätigt aktive Anzeigen zeigen (unklare ausblenden)
                </label>
              </div>
              <p className="field-hint">
                Aus = unklare Anzeigen bleiben sichtbar und sind als „zu prüfen“ markiert. Ein = die Liste
                zeigt ausschließlich bestätigte Anzeigen — dabei fällt gelegentlich auch eine gute Wohnung
                weg, deren Portal das Auslesen blockiert.
              </p>

              <div className="grid-3">
                <div>
                  <label htmlFor="aliveAtOrAbove">„Aktiv“ ab (%)</label>
                  <input
                    id="aliveAtOrAbove"
                    name="aliveAtOrAbove"
                    type="number"
                    min={51}
                    max={100}
                    className="input"
                    defaultValue={liveness.aliveAtOrAbove}
                    disabled={!isAdmin}
                  />
                </div>
                <div>
                  <label htmlFor="goneAtOrBelow">„Weg“ bis (%)</label>
                  <input
                    id="goneAtOrBelow"
                    name="goneAtOrBelow"
                    type="number"
                    min={0}
                    max={49}
                    className="input"
                    defaultValue={liveness.goneAtOrBelow}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">Dazwischen: „zu prüfen“</p>
                </div>
                <div>
                  <label htmlFor="checkOnSearchLimit">Anzeigen pro Suchaufruf</label>
                  <input
                    id="checkOnSearchLimit"
                    name="checkOnSearchLimit"
                    type="number"
                    min={1}
                    max={50}
                    className="input"
                    defaultValue={liveness.checkOnSearchLimit}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">Klein halten — es wird gewartet</p>
                </div>
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
              <div className="grid-2">
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
                    defaultValue={liveness.perHostDelayMs}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">
                    Höflichkeit gegenüber den Portalen — nicht kleiner als nötig einstellen.
                  </p>
                </div>
                <div>
                  <label htmlFor="maxBytesPerPage">Gelesene Textmenge je Seite (Bytes)</label>
                  <input
                    id="maxBytesPerPage"
                    name="maxBytesPerPage"
                    type="number"
                    min={16000}
                    max={1000000}
                    step={10000}
                    className="input"
                    defaultValue={liveness.maxBytesPerPage}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">
                    Der Hinweis „nicht mehr verfügbar“ steht oben, das Einstelldatum oft weit unten.
                  </p>
                </div>
              </div>
              <div className="callout">
                <span className="callout-icon" aria-hidden>i</span>
                <div>
                  Blockiert ein Portal den Abruf oder antwortet es nicht, wird <strong>nichts</strong>{' '}
                  überschrieben — der zuletzt gelesene Prozentwert bleibt stehen, und die Anzeige kann
                  dadurch nie automatisch verschwinden. Abgelaufen wird nur, wenn der Seitentext selbst es
                  mehrfach hintereinander sagt.
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

          {/* --------------------------------------------- mailbox rules --- */}
          <form action={saveMailboxSettingsAction} className="card" id="postfachregeln" style={{ marginTop: 18 }}>
            <div className="card-head">
              <h2>Was die App im Postfach darf</h2>
              <span className={`lamp lamp-${mailbox.readOnly ? 'running' : 'setup'}`}>
                <span className="lamp-dot" aria-hidden />
                {mailbox.readOnly ? 'Nur lesen' : 'Darf als gelesen markieren'}
              </span>
            </div>
            <div className="card-body stack">
              <Callout tone="info">
                Die App <strong>löscht nie</strong> eine E-Mail, verschiebt nichts und antwortet nicht von
                allein. Das Einzige, was sie überhaupt schreiben könnte, ist die Markierung
                &bdquo;gelesen&ldquo; — und auch das nur, wenn der Haken unten gesetzt ist.
              </Callout>
              <div className="checkline">
                <input
                  id="mailboxReadOnly"
                  name="readOnly"
                  type="checkbox"
                  value="true"
                  defaultChecked={mailbox.readOnly}
                  disabled={!isAdmin}
                />
                <label htmlFor="mailboxReadOnly">
                  Nur lesen — nichts im Postfach verändern (empfohlen bei einem geteilten Postfach, z. B.
                  in Front)
                </label>
              </div>
              <p className="field-hint">
                Ein geteiltes Postfach lebt von seinem Ungelesen-Status: markiert die App eine Antwort als
                gelesen, verschwindet sie aus der Liste der Kollegin, die sie beantworten soll. Doppelte
                Einträge entstehen dadurch nicht — dagegen schützt die Message-ID, nicht die Markierung.
              </p>
              <div className="grid-2">
                <div>
                  <label htmlFor="lookbackDays">Wie weit zurückschauen (Tage)</label>
                  <input
                    id="lookbackDays"
                    name="lookbackDays"
                    type="number"
                    min={1}
                    max={90}
                    className="input"
                    defaultValue={mailbox.lookbackDays}
                    disabled={!isAdmin}
                  />
                  <p className="field-hint">Gilt nur im Nur-lesen-Modus.</p>
                </div>
              </div>
            </div>
            {isAdmin ? (
              <div className="card-foot row-between">
                <span className="small muted">Gilt ab der nächsten Abholung.</span>
                <button type="submit" className="btn primary">
                  Speichern
                </button>
              </div>
            ) : null}
          </form>

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
          </div>
        </details>
      </main>
    </>
  );
}
