import { ADAPTERS, adapterChoices, missingConfig } from '@/domain/discovery/registry';
import {
  saveSourceDiscoveryFormAction,
  saveOutboundSettingsAction,
  saveFollowUpSettingsAction,
  saveAccountFormAction,
  deleteAccountAction,
  verifyMailboxFormAction,
  runDiscoverySweepFormAction,
} from '@/app/actions';
import { Callout } from '@/app/_components/Shell';
import { InstantNumber, InstantSwitch } from './_instant';
import { formatDateTime } from '@/lib/labels';
import type { DiscoverySettings, OutboundSettings, FollowUpSettings } from '@/server/settings';
import type { PortalAccountView } from '@/server/portalAccounts';

export interface SourceRow {
  id: string;
  key: string;
  name: string;
  discoveryAdapter: string | null;
  discoveryEnabled: boolean;
  discoveryConfig: unknown;
  discoveryStatus: string | null;
  discoveryNote: string | null;
  lastDiscoveredAt: Date | null;
  pollIntervalMinutes: number | null;
}

/* ============================================== automatic discovery ==== */

export function DiscoverySection({
  settings,
  sources,
  runs,
  isAdmin,
}: {
  settings: DiscoverySettings;
  sources: SourceRow[];
  runs: Array<{
    id: string;
    sourceName: string;
    adapter: string;
    status: string;
    found: number;
    created: number;
    retired: number;
    message: string | null;
    startedAt: Date;
  }>;
  isAdmin: boolean;
}) {
  const choices = adapterChoices();
  // Split by "can this be searched at all", not by "has somebody touched it":
  // a source with no adapter cannot be switched on however it is presented,
  // and mixing the two made a list of fifty in which the four that mattered
  // were indistinguishable.
  const searchable = sources.filter((s) => s.discoveryAdapter);
  const unsearchable = sources.filter((s) => !s.discoveryAdapter);
  const enabledCount = sources.filter((s) => s.discoveryEnabled).length;

  return (
    <>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h2>Automatische Suche</h2>
          <span className="sub">
            Sucht selbstständig neue Anzeigen und entfernt verschwundene. Alles hier speichert sofort.
          </span>
        </div>
        <div className="card-body stack">
          <InstantSwitch
            checked={settings.enabled}
            disabled={!isAdmin}
            label="Automatische Suche aktiv"
            hint="Aus heißt: es wird gar nicht mehr gesucht."
          />

          <Callout tone="info">
            Es werden nur Quellen abgefragt, die unten eingeschaltet sind. Die App hält sich an die
            robots.txt jeder Seite und begrenzt jeden Lauf. Portale, die automatische Abrufe sperren
            (ImmoScout24, Immowelt), bleiben beim E-Mail-Suchauftrag.
          </Callout>

          {/* The seven knobs are real settings, but nobody opening this page is
              looking for "Pause je Server (ms)". Folded away, so the two things
              that decide whether the tool works — is it on, which sources —
              are the only things on screen. */}
          <details className="disclosure">
            <summary>Feineinstellungen der Suche</summary>
            <div className="grid-3" style={{ marginTop: 12 }}>
              <InstantNumber
                name="sweepIntervalMinutes"
                label="Mindestabstand (Minuten)"
                value={settings.sweepIntervalMinutes}
                disabled={!isAdmin}
                hint="Häufiger als das wird nicht gesucht, egal wie oft jemand die Seite öffnet."
              />
              <InstantNumber
                name="maxRequestsPerRun"
                label="Anfragen je Lauf"
                value={settings.maxRequestsPerRun}
                disabled={!isAdmin}
                hint="Obergrenze über alle Quellen zusammen."
              />
              <InstantNumber
                name="perHostDelayMs"
                label="Pause je Server (ms)"
                value={settings.perHostDelayMs}
                disabled={!isAdmin}
                hint="Abstand zwischen zwei Anfragen an dieselbe Seite."
              />
              <InstantNumber
                name="maxPagesPerSource"
                label="Ergebnisseiten je Quelle"
                value={settings.maxPagesPerSource}
                disabled={!isAdmin}
              />
              <InstantNumber
                name="enrichPerRun"
                label="Detailseiten je Lauf"
                value={settings.enrichPerRun}
                disabled={!isAdmin}
                hint="Holt Nebenkosten, Termin und Kontaktadresse von der Anzeigenseite. 0 = aus."
              />
              <InstantNumber
                name="retireAfterMissedSweeps"
                label="Läufe bis Ausblenden"
                value={settings.retireAfterMissedSweeps}
                disabled={!isAdmin}
                hint="So oft darf eine Anzeige fehlen, bevor sie verschwindet."
              />
              <InstantNumber
                name="priceSlack"
                label="Preis-Puffer"
                value={settings.priceSlack}
                step="0.05"
                disabled={!isAdmin}
                hint="Suche über dem Budget, weil Portale nach Kaltmiete filtern, wir aber warm rechnen."
              />
            </div>
          </details>

          <p className="small muted">
            {runs.length > 0 ? `Letzter Suchlauf: ${formatDateTime(runs[0].startedAt)}` : 'Noch kein Suchlauf.'}
          </p>
        </div>
      </div>

      {isAdmin ? (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Quellen</h2>
            <span className="sub">
              {enabledCount === 0
                ? 'Keine aktiv — die Suche findet nichts.'
                : `${enabledCount} von ${searchable.length} aktiv. Änderungen werden sofort gespeichert.`}
            </span>
            <div className="grow" />
            <form action={runDiscoverySweepFormAction}>
              <button className="btn sm primary" type="submit">
                Jetzt suchen
              </button>
            </form>
          </div>
          <div className="card-body stack">
            {enabledCount === 0 ? (
              <Callout tone="warning">
                Schalten Sie unten mindestens eine Quelle ein. Es wird sofort gespeichert — kein
                Speichern-Knopf nötig.
              </Callout>
            ) : null}

            {/* Sources that can actually be searched, first and on their own.
                Everything the adapter needs is hidden until asked for: the
                choice a colleague makes here is "search this or not", and the
                JSON box next to it made that look like a developer's job. */}
            <div className="source-list">
              {searchable.map((source) => (
                <SourceRowItem key={source.id} source={source} choices={choices} />
              ))}
            </div>

            {unsearchable.length > 0 ? (
              <details className="disclosure">
                <summary>
                  {unsearchable.length} Quellen ohne automatische Suche — nur als Link nutzbar
                </summary>
                <div className="source-list" style={{ marginTop: 10 }}>
                  {unsearchable.map((source) => (
                    <SourceRowItem key={source.id} source={source} choices={choices} />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Letzte Suchläufe</h2>
          </div>
          <div className="card-body">
            <table className="table">
              <thead>
                <tr>
                  <th>Quelle</th>
                  <th>Status</th>
                  <th>Gefunden</th>
                  <th>Neu</th>
                  <th>Entfernt</th>
                  <th>Zeitpunkt</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.sourceName}</td>
                    <td>
                      <span className={r.status === 'OK' ? 'badge success' : 'badge danger'}>{r.status}</span>
                      {r.message ? <div className="small muted">{r.message}</div> : null}
                    </td>
                    <td>{r.found}</td>
                    <td>{r.created}</td>
                    <td>{r.retired}</td>
                    <td className="small muted">{formatDateTime(r.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * One source, as one line.
 *
 * The switch is the whole interaction and it writes immediately. Everything an
 * adapter needs — the method, its JSON, the polling interval — sits behind
 * "Einstellungen", because deciding whether to search a portal and configuring
 * how to search it are different jobs, and putting a JSON box beside the
 * switch made the first one look like the second.
 */
function SourceRowItem({
  source,
  choices,
}: {
  source: SourceRow;
  choices: Array<{ key: string; label: string; description: string }>;
}) {
  const config = (source.discoveryConfig as Record<string, unknown>) ?? {};
  const gaps = missingConfig(source.discoveryAdapter, config);
  const adapter = choices.find((c) => c.key === source.discoveryAdapter);
  const hints = source.discoveryAdapter ? adapterHints(source.discoveryAdapter) : [];
  const blocked = !source.discoveryAdapter;
  const state = sourceState(source, gaps);

  return (
    <div className="source-item">
      <InstantSwitch
        checked={source.discoveryEnabled}
        disabled={blocked}
        label={source.name}
        hint={
          blocked
            ? 'Kein Verfahren hinterlegt — unter „Einstellungen" eines wählen'
            : (adapter?.description ?? undefined)
        }
        sourceId={source.id}
      />

      <div className="source-item-meta">
        <span className={`lamp lamp-${state.readiness.toLowerCase()}`}>
          <span className="lamp-dot" aria-hidden />
          {state.label}
        </span>
      </div>

      {state.todo ? <p className="source-item-note">{state.todo}</p> : null}

      <details className="disclosure sm">
        <summary>Technische Einstellungen — nur wenn nötig</summary>
        <form action={saveSourceDiscoveryFormAction} className="stack" style={{ marginTop: 10 }}>
          <input type="hidden" name="sourceId" value={source.id} />
          {/* The switch above owns this value; the hidden field keeps the form
              from switching the source off just because it posted without it. */}
          {source.discoveryEnabled ? (
            <input type="hidden" name="discoveryEnabled" value="true" />
          ) : null}

          <div className="grid-2">
            <div className="field">
              <label htmlFor={`adapter-${source.id}`}>Verfahren</label>
              <select
                id={`adapter-${source.id}`}
                name="discoveryAdapter"
                className="input"
                defaultValue={source.discoveryAdapter ?? ''}
              >
                <option value="">— keine automatische Suche —</option>
                {choices.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`poll-${source.id}`}>Prüfabstand (Minuten)</label>
              <input
                id={`poll-${source.id}`}
                name="pollIntervalMinutes"
                type="number"
                min={5}
                className="input"
                defaultValue={source.pollIntervalMinutes ?? ''}
                placeholder="Standard"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor={`config-${source.id}`}>Technische Konfiguration</label>
            <textarea
              id={`config-${source.id}`}
              name="config"
              className="input"
              rows={3}
              defaultValue={JSON.stringify(config, null, 1)}
            />
          </div>

          {hints.length > 0 ? (
            <ul className="small muted">
              {hints.map((h) => (
                <li key={h.key}>
                  <code>{h.key}</code>
                  {h.required ? ' (nötig)' : ' (optional)'} — {h.hint}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn sm" type="submit">
              Übernehmen
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

/**
 * One word and one colour for "can I use this source?".
 *
 * The page used to answer that with two separate things: a badge holding a
 * machine word (OK, BLOCKED, ROBOTS_DENIED) and, beside it, a red list of
 * missing config keys — "Fehlt: searchUrlTemplate, linkPattern". Neither tells
 * a colleague whether the source works or what to do about it, and on a screen
 * of fifty the red on every row read as "everything is broken".
 *
 * The four states are the four things that can actually be true, and each one
 * carries its own next step.
 */
type Readiness = 'RUNNING' | 'SETUP' | 'BLOCKED' | 'OFF';

interface SourceState {
  readiness: Readiness;
  label: string;
  /** What to do about it, in plain German. Null when there is nothing to do. */
  todo: string | null;
}

function sourceState(source: SourceRow, gaps: string[]): SourceState {
  if (!source.discoveryAdapter) {
    return {
      readiness: 'OFF',
      label: 'Nur als Link',
      todo: 'Diese Seite kann nicht automatisch gelesen werden — sie bleibt zum Selbstsuchen.',
    };
  }
  if (gaps.length > 0) {
    return {
      readiness: 'SETUP',
      label: 'Muss eingerichtet werden',
      // Named as the thing a person has, not as the field it goes in.
      todo: gaps.includes('searchUrl') || gaps.includes('searchUrlTemplate')
        ? 'Einmalig eine Such-URL aus dem Browser einfügen — unter „Einstellungen".'
        : `Unter „Einstellungen" noch angeben: ${gaps.join(', ')}.`,
    };
  }
  if (source.discoveryStatus === 'BLOCKED' || source.discoveryStatus === 'ROBOTS_DENIED') {
    return {
      readiness: 'BLOCKED',
      label: source.discoveryStatus === 'BLOCKED' ? 'Portal blockiert uns' : 'Portal verbietet Abrufe',
      todo: 'Dieses Portal lässt keine automatischen Abrufe zu. Über den E-Mail-Suchauftrag nutzen.',
    };
  }
  if (source.discoveryStatus === 'ERROR') {
    return { readiness: 'BLOCKED', label: 'Fehler beim letzten Lauf', todo: source.discoveryNote };
  }
  if (!source.discoveryEnabled) {
    return { readiness: 'OFF', label: 'Bereit — noch aus', todo: 'Einschalten, dann wird hier gesucht.' };
  }
  return {
    readiness: 'RUNNING',
    label: source.discoveryStatus === 'OK' ? 'Läuft' : 'Eingeschaltet',
    todo: source.discoveryNote,
  };
}

/**
 * Whether an Anfrage can actually leave the building.
 *
 * Sending, the reply inbox and the follow-up tasks are all built; the feature
 * was off because no sending address had been entered, and the page said
 * nothing about it. A switch that is on while the thing behind it cannot work
 * is worse than one that is off.
 */
function sendingState(outbound: OutboundSettings): SourceState {
  if (!outbound.fromAddress.trim()) {
    return {
      readiness: 'SETUP',
      label: 'Noch nicht eingerichtet',
      todo:
        'Ohne Absenderadresse kann die App keine Anfrage verschicken — jede Anfrage muss dann von Hand im Portal geschrieben werden. Adresse eintragen, die Plus-Adressen annimmt (name+kennung@…), damit Antworten automatisch zugeordnet werden.',
    };
  }
  if (!outbound.enabled) {
    return {
      readiness: 'OFF',
      label: 'Eingerichtet, aber aus',
      todo: 'Der Haken oben schaltet den Versand frei.',
    };
  }
  return { readiness: 'RUNNING', label: 'Versand bereit', todo: null };
}

function adapterHints(key: string) {
  return ADAPTERS.find((a) => a.key === key)?.configKeys ?? [];
}

/* ==================================================== accounts & mail ==== */

export function AccountsSection({
  accounts,
  outbound,
  followUp,
  isAdmin,
  credentialKeyOk,
  sources,
}: {
  accounts: PortalAccountView[];
  outbound: OutboundSettings;
  followUp: FollowUpSettings;
  isAdmin: boolean;
  credentialKeyOk: boolean;
  sources: Array<{ id: string; key: string; name: string }>;
}) {
  const mailbox = accounts.find((a) => a.kind === 'MAILBOX');
  const portals = accounts.filter((a) => a.kind === 'PORTAL');

  return (
    <>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h2>Konten &amp; Postfach</h2>
          <span className="sub">
            Damit Anfragen aus der App rausgehen und Antworten hier ankommen — ohne Portal-Tabs.
          </span>
        </div>
        <div className="card-body stack">
          {!credentialKeyOk ? (
            <Callout tone="danger">
              <strong>CREDENTIAL_KEY fehlt.</strong> Ohne diesen Serverschlüssel werden keine Passwörter
              gespeichert — Zugangsdaten würden sonst im Klartext in der Datenbank liegen. In der
              Serverkonfiguration einen zufälligen Wert mit mindestens 32 Zeichen hinterlegen:
              <br />
              <code>node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64url&apos;))&quot;</code>
            </Callout>
          ) : (
            <Callout tone="info">
              Passwörter werden mit AES-256-GCM verschlüsselt gespeichert und nie wieder angezeigt — auch
              nicht hier. Ein leeres Passwortfeld lässt das gespeicherte Passwort unverändert.
            </Callout>
          )}

          <h3 className="small" style={{ marginTop: 4 }}>
            Gemeinsames Postfach
          </h3>
          {mailbox ? (
            <div className="subcard row-between">
              <div className="stack" style={{ gap: 3 }}>
                <strong>{mailbox.label}</strong>
                <span className="small muted">
                  {mailbox.loginName} · {String(mailbox.meta.smtpHost ?? '—')} ·{' '}
                  {mailbox.hasSecret ? 'Passwort hinterlegt' : 'kein Passwort'}
                </span>
                <span className={mailbox.status === 'OK' ? 'badge success' : 'badge'}>
                  {mailbox.status}
                  {mailbox.statusNote ? ` — ${mailbox.statusNote}` : ''}
                  {mailbox.lastVerifiedAt ? ` (${formatDateTime(mailbox.lastVerifiedAt)})` : ''}
                </span>
              </div>
              {isAdmin ? (
                <div className="row" style={{ gap: 8 }}>
                  <form action={verifyMailboxFormAction}>
                    <button className="btn sm" type="submit">
                      Verbindung testen
                    </button>
                  </form>
                  <form action={deleteAccountAction}>
                    <input type="hidden" name="id" value={mailbox.id} />
                    <button className="btn sm ghost" type="submit">
                      Entfernen
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          ) : null}

          {isAdmin ? <MailboxForm existing={mailbox} /> : null}

          <h3 className="small" style={{ marginTop: 14 }}>
            Portal-Zugänge
          </h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Für Portale, bei denen die Anfrage nur über das eigene Formular geht. Die App speichert den
            Zugang, damit klar ist, mit welchem Konto gearbeitet wird — angemeldet wird sich weiterhin im
            Portal selbst. Automatisches Einloggen wäre ein Verstoß gegen deren Nutzungsbedingungen und
            würde das Konto gefährden.
          </p>

          {portals.length === 0 ? (
            <span className="small muted">Noch keine Portal-Zugänge hinterlegt.</span>
          ) : (
            <ul className="list">
              {portals.map((a) => (
                <li key={a.id} className="list-row row-between">
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{a.label}</strong>
                    <span className="small muted">
                      {a.sourceName ?? a.siteKey}
                      {a.loginName ? ` · ${a.loginName}` : ''}
                      {a.hasSecret ? ' · Passwort hinterlegt' : ' · kein Passwort'}
                      {a.replyToAddress ? ` · Antworten an ${a.replyToAddress}` : ''}
                    </span>
                  </div>
                  {isAdmin ? (
                    <form action={deleteAccountAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="btn sm ghost" type="submit">
                        Entfernen
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {isAdmin ? <PortalAccountForm sources={sources} /> : null}
        </div>
      </div>

      {/* ------------------------------------------------- send settings --- */}
      <form action={saveOutboundSettingsAction} className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h2>Versand aus der App</h2>
          <div className="grow" />
          {/* The whole feature is built and was simply switched off, with
              nothing on screen saying so. Somebody looking for "why can I not
              send from here" had to infer it from an empty text field. */}
          <span className={`lamp lamp-${sendingState(outbound).readiness.toLowerCase()}`}>
            <span className="lamp-dot" aria-hidden />
            {sendingState(outbound).label}
          </span>
        </div>
        <div className="card-body stack">
          {sendingState(outbound).todo ? (
            <Callout tone="warning">{sendingState(outbound).todo}</Callout>
          ) : null}
          <div className="checkline">
            <input
              id="outboundEnabled"
              name="enabled"
              type="checkbox"
              value="true"
              defaultChecked={outbound.enabled}
              disabled={!isAdmin}
            />
            <label htmlFor="outboundEnabled">Anfragen dürfen aus der App gesendet werden</label>
          </div>
          <div className="grid-2">
            <TextField name="fromName" label="Absendername" value={outbound.fromName} disabled={!isAdmin} />
            <TextField
              name="fromAddress"
              label="Absenderadresse"
              value={outbound.fromAddress}
              disabled={!isAdmin}
              hint="Muss Plus-Adressen annehmen (name+kennung@…) — daran wird jede Antwort erkannt."
            />
            <TextField
              name="subjectTemplate"
              label="Betreff"
              value={outbound.subjectTemplate}
              disabled={!isAdmin}
              hint="{title} und {city} werden ersetzt."
            />
            <NumberField
              name="maxPerHour"
              label="Max. Anfragen pro Stunde"
              value={outbound.maxPerHour}
              disabled={!isAdmin}
              hint="Gilt für das ganze Team. Schützt die Absenderadresse vor Sperren."
            />
          </div>
        </div>
        {isAdmin ? (
          <div className="card-foot row-between">
            <span className="small muted">
              Anfragen gehen nur an Adressen, die in der Anzeige selbst veröffentlicht sind.
            </span>
            <button type="submit" className="btn primary">
              Speichern
            </button>
          </div>
        ) : null}
      </form>

      {/* ---------------------------------------------------- follow-ups --- */}
      <form action={saveFollowUpSettingsAction} className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h2>Wiedervorlagen</h2>
        </div>
        <div className="card-body stack">
          <div className="checkline">
            <input
              id="autoCreate"
              name="autoCreate"
              type="checkbox"
              value="true"
              defaultChecked={followUp.autoCreate}
              disabled={!isAdmin}
            />
            <label htmlFor="autoCreate">
              Nach jeder Anfrage automatisch &bdquo;Antwort pr&uuml;fen&ldquo; eintragen
            </label>
          </div>
          <div className="grid-2">
            <NumberField
              name="checkReplyAfterDays"
              label="Erste Nachfrage nach (Tagen)"
              value={followUp.checkReplyAfterDays}
              disabled={!isAdmin}
            />
            <NumberField
              name="secondCheckAfterDays"
              label="Zweite Nachfrage nach weiteren (Tagen)"
              value={followUp.secondCheckAfterDays}
              disabled={!isAdmin}
              hint="0 = keine zweite Nachfrage."
            />
          </div>
        </div>
        {isAdmin ? (
          <div className="card-foot row-between">
            <span className="small muted">Antwortet jemand, verschwindet die Aufgabe von selbst.</span>
            <button type="submit" className="btn primary">
              Speichern
            </button>
          </div>
        ) : null}
      </form>
    </>
  );
}

function MailboxForm({ existing }: { existing?: PortalAccountView }) {
  const meta = existing?.meta ?? {};
  return (
    <form action={saveAccountFormAction} className="subcard stack">
      <input type="hidden" name="kind" value="MAILBOX" />
      <input type="hidden" name="siteKey" value="mailbox" />
      {existing ? <input type="hidden" name="id" value={existing.id} /> : null}
      <strong className="small">{existing ? 'Postfach bearbeiten' : 'Postfach einrichten'}</strong>
      <div className="grid-2">
        <TextField idPrefix="mb-" name="label" label="Bezeichnung" value={existing?.label ?? 'Wohnungssuche-Postfach'} />
        <TextField idPrefix="mb-" name="loginName" label="Benutzername" value={existing?.loginName ?? ''} />
        <TextField idPrefix="mb-" name="smtpHost" label="SMTP-Server" value={String(meta.smtpHost ?? '')} />
        <TextField idPrefix="mb-" name="smtpPort" label="SMTP-Port" value={String(meta.smtpPort ?? '587')} />
        <TextField idPrefix="mb-" name="imapHost" label="IMAP-Server" value={String(meta.imapHost ?? '')} hint="Leer = wie SMTP." />
        <TextField idPrefix="mb-" name="imapPort" label="IMAP-Port" value={String(meta.imapPort ?? '993')} />
      </div>
      <div className="grid-2">
        <div>
          <label htmlFor="mailboxSecret">Passwort</label>
          <input
            id="mailboxSecret"
            name="secret"
            type="password"
            className="input"
            autoComplete="new-password"
            placeholder={existing?.hasSecret ? 'unverändert lassen' : 'App-Passwort'}
          />
        </div>
        <div>
          <label htmlFor="mailboxSecret2">IMAP-Passwort (nur falls abweichend)</label>
          <input
            id="mailboxSecret2"
            name="secondarySecret"
            type="password"
            className="input"
            autoComplete="new-password"
            placeholder="leer = wie oben"
          />
        </div>
      </div>
      <input type="hidden" name="active" value="true" />
      <div className="row">
        <button className="btn sm primary" type="submit">
          Speichern
        </button>
      </div>
    </form>
  );
}

/**
 * Adding a portal login, asked the way a person would think about it.
 *
 * The old form wanted seven fields before it would accept anything, among them
 * a "Website / Kennung" and a "Bezeichnung" — bookkeeping the database needs
 * and the person filling it in has no opinion about. Both are now taken from
 * the portal they picked out of the list. What is left is what somebody
 * actually has written on a piece of paper: which site, which username, which
 * password.
 */
function PortalAccountForm({ sources }: { sources: Array<{ id: string; key: string; name: string }> }) {
  return (
    <form action={saveAccountFormAction} className="subcard stack">
      <input type="hidden" name="kind" value="PORTAL" />
      <input type="hidden" name="active" value="true" />
      <strong className="small">Zugang zu einem Portal hinterlegen</strong>
      <p className="small muted" style={{ margin: 0 }}>
        Damit kann die App sich dort anmelden und Anfragen für Sie verschicken. Das Passwort wird
        verschlüsselt gespeichert und nie wieder angezeigt.
      </p>

      <div className="grid-3">
        <div className="field">
          <label htmlFor="accountSource">Welches Portal?</label>
          <select id="accountSource" name="sourceId" className="input" defaultValue="" required>
            <option value="">Bitte wählen …</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pa-loginName">Benutzername oder E-Mail</label>
          <input
            id="pa-loginName"
            name="loginName"
            className="input"
            autoComplete="username"
            placeholder="wie beim Anmelden auf der Seite"
          />
        </div>
        <div className="field">
          <label htmlFor="portalSecret">Passwort</label>
          <input
            id="portalSecret"
            name="secret"
            type="password"
            className="input"
            autoComplete="new-password"
            placeholder="wird verschlüsselt gespeichert"
          />
        </div>
      </div>

      {/* Everything below is for the rare case; hidden so the common one is
          three boxes and a button. */}
      <details className="disclosure">
        <summary>Weitere Angaben (selten nötig)</summary>
        <div className="grid-2" style={{ marginTop: 10 }}>
          <TextField
            idPrefix="pa-"
            name="replyToAddress"
            label="Antworten kommen an"
            value=""
            hint="Nur ausfüllen, wenn das Portal Antworten an eine andere Adresse schickt."
          />
          <TextField
            idPrefix="pa-"
            name="profileUrl"
            label="Login-Adresse"
            value=""
            hint="Nur nötig, wenn die Anmeldeseite nicht die Startseite ist."
          />
          <TextField idPrefix="pa-" name="label" label="Eigener Name für diesen Zugang" value="" hint="Sonst der Name des Portals." />
          <TextField idPrefix="pa-" name="note" label="Notiz" value="" />
        </div>
      </details>

      <div className="row">
        <button className="btn primary" type="submit">
          Zugang speichern
        </button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------- fields ---- */

function TextField({
  name,
  label,
  value,
  hint,
  disabled,
  idPrefix = '',
}: {
  name: string;
  label: string;
  value: string;
  hint?: string;
  disabled?: boolean;
  /** Several forms on one page reuse field names, so ids need scoping. */
  idPrefix?: string;
}) {
  const id = `${idPrefix}${name}`;
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} className="input" defaultValue={value} disabled={disabled} />
      {hint ? <span className="small muted">{hint}</span> : null}
    </div>
  );
}

function NumberField({
  name,
  label,
  value,
  hint,
  step,
  disabled,
  idPrefix = '',
}: {
  name: string;
  label: string;
  value: number;
  hint?: string;
  step?: string;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const id = `${idPrefix}${name}`;
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type="number"
        step={step}
        className="input"
        defaultValue={value}
        disabled={disabled}
      />
      {hint ? <span className="small muted">{hint}</span> : null}
    </div>
  );
}
