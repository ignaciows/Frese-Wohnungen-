import { ADAPTERS, adapterChoices, missingConfig } from '@/domain/discovery/registry';
import {
  saveSourceDiscoveryFormAction,
  saveOutboundSettingsAction,
  saveFollowUpSettingsAction,
  saveAccountFormAction,
  deleteAccountAction,
  verifyMailboxFormAction,
  verifyPortalAccountFormAction,
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
      <div className="card" id="suche" style={{ marginTop: 18 }}>
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
            hint="Aus = es wird nicht gesucht."
          />

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
                hint="Kürzester Abstand zwischen zwei Suchläufen."
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
                hint="Pause zwischen zwei Abrufen."
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
                hint="0 = aus."
              />
              <InstantNumber
                name="retireAfterMissedSweeps"
                label="Läufe bis Ausblenden"
                value={settings.retireAfterMissedSweeps}
                disabled={!isAdmin}
                hint="Fehlt sie so oft, verschwindet sie."
              />
              <InstantNumber
                name="priceSlack"
                label="Preis-Puffer"
                value={settings.priceSlack}
                step="0.05"
                disabled={!isAdmin}
                hint="Sucht etwas über dem Budget."
              />
            </div>
          </details>

          <p className="small muted">
            {runs.length > 0 ? `Letzter Suchlauf: ${formatDateTime(runs[0].startedAt)}` : 'Noch kein Suchlauf.'}
          </p>
        </div>
      </div>

      {isAdmin ? (
        <div className="card" id="quellen" style={{ marginTop: 18 }}>
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
              <Callout tone="warning">Mindestens eine Quelle einschalten.</Callout>
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
  const hints = source.discoveryAdapter ? adapterHints(source.discoveryAdapter) : [];
  const blocked = !source.discoveryAdapter;
  const state = sourceState(source, gaps);

  // A source the code cannot read has nothing to configure, and rendering the
  // full form for each of the eighty-odd of them put a method dropdown, a JSON
  // box and a list of hints into the page eighty times over — most of the
  // markup on the page, for rows nobody can switch on. Name and lamp is the
  // whole truth about them.
  if (blocked) {
    return (
      <div className="source-item">
        <div className="switch-row is-disabled">
          <span className="switch-track" aria-hidden>
            <span className="switch-thumb" />
          </span>
          <span className="switch-text">
            <span className="switch-label">{source.name}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="source-item">
      <InstantSwitch
        checked={source.discoveryEnabled}
        disabled={blocked}
        label={source.name}
        // No hint on the row. The adapter's description is the same sentence
        // on every source that uses it — printed fifty times it was most of
        // the page, and it says nothing about *this* source. What is specific
        // to the row is its state, and that is the lamp underneath.
        hint={undefined}
        sourceId={source.id}
      />

      <div className="source-item-meta">
        <span className={`lamp lamp-${state.readiness.toLowerCase()}`}>
          <span className="lamp-dot" aria-hidden />
          {state.label}
        </span>
      </div>

      {/* Only where somebody has to act. On the rows that are simply off, or
          link-only, the note repeated one identical sentence down the whole
          list and buried the few that needed attention. */}
      {state.todo && (state.readiness === 'SETUP' || state.readiness === 'BLOCKED') ? (
        <p className="source-item-note">{state.todo}</p>
      ) : null}

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
/**
 * Whether a stored login is usable, in the same four colours as everything
 * else on this page.
 *
 * A row that said "Passwort hinterlegt" answered whether we hold a password,
 * not whether it works — and those are different questions, the second being
 * the one that matters the morning somebody tries to send fifteen enquiries.
 */
function accountReadiness(a: PortalAccountView): 'running' | 'setup' | 'blocked' | 'off' {
  if (!a.active) return 'off';
  if (!a.hasSecret) return 'setup';
  if (a.status === 'FAILED') return 'blocked';
  return a.status === 'OK' ? 'running' : 'setup';
}

function accountLabel(a: PortalAccountView): string {
  if (!a.active) return 'Deaktiviert';
  if (!a.hasSecret) return 'Passwort fehlt';
  if (a.status === 'FAILED') return a.statusNote ? `Anmeldung fehlgeschlagen — ${a.statusNote}` : 'Anmeldung fehlgeschlagen';
  if (a.status === 'OK') return 'Geprüft — funktioniert';
  return 'Noch nicht geprüft';
}

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

/**
 * The portals worth naming on this page.
 *
 * Practically every flat this tool finds comes from one of these three, so
 * whether we hold a login for them is a question the page should answer
 * without being asked. `match` is checked against the source name as well as
 * the key, because an account can be attached to a catalogue entry whose key
 * was spelled differently ("immoscout" vs "immoscout24").
 */
const KEY_PORTALS = [
  {
    key: 'kleinanzeigen',
    match: 'kleinanzeigen',
    name: 'Kleinanzeigen (früher eBay Kleinanzeigen)',
    why: 'Liefert die meisten Treffer. Der Zugang wird zum Antworten im Portal gebraucht.',
  },
  {
    key: 'immoscout24',
    match: 'immoscout',
    name: 'ImmoScout24',
    why: 'Sperrt automatische Abrufe — Zugang für den Suchauftrag per E-Mail.',
  },
  {
    key: 'immowelt',
    match: 'immowelt',
    name: 'Immowelt',
    why: 'Detailseiten sind für uns nicht lesbar — Zugang für den Suchauftrag per E-Mail.',
  },
] as const;

export function AccountsSection({
  accounts,
  outbound,
  followUp,
  isAdmin,
  credentialKeyOk,
  sources,
  preselectPortalKey,
}: {
  accounts: PortalAccountView[];
  outbound: OutboundSettings;
  followUp: FollowUpSettings;
  isAdmin: boolean;
  credentialKeyOk: boolean;
  sources: Array<{ id: string; key: string; name: string }>;
  /** Portal the form should open on, from `?portal=` — see the rows above it. */
  preselectPortalKey?: string | null;
}) {
  const mailbox = accounts.find((a) => a.kind === 'MAILBOX');
  const portals = accounts.filter((a) => a.kind === 'PORTAL');

  return (
    <>
      <div className="card" id="konten" style={{ marginTop: 18 }}>
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
            Portal-Zugänge
          </h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            Anmelden müssen Sie sich weiterhin selbst. „Prüfen&ldquo; testet, ob das gespeicherte
            Passwort noch lesbar ist.
          </p>

          {/* The three portals nearly every flat comes from, named and always
              listed — including the ones with no account yet.
              A missing login used to be invisible: the list showed what was
              stored, so "wo trage ich das Kleinanzeigen-Konto ein" had no
              answer anywhere on the page. An empty row with a button is the
              answer. */}
          <div className="portal-checklist">
            {KEY_PORTALS.map((p) => {
              const account = portals.find(
                (a) => a.siteKey === p.key || a.sourceName?.toLowerCase().includes(p.match),
              );
              return (
                <div key={p.key} className="portal-row">
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{p.name}</strong>
                    <span className="small muted">{p.why}</span>
                  </div>
                  {account ? (
                    <span className={`lamp lamp-${accountReadiness(account)}`}>
                      <span className="lamp-dot" aria-hidden />
                      {accountLabel(account)}
                    </span>
                  ) : (
                    <a className="btn sm" href={`?portal=${p.key}#zugang-hinterlegen`}>
                      {isAdmin ? 'Zugang hinterlegen' : 'Kein Zugang hinterlegt'}
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          <Callout tone="info">
            <strong>ImmoScout24 und Immowelt sperren automatische Abrufe.</strong> Dort im Portal einen
            Suchauftrag anlegen, der an das gemeinsame Postfach unten schickt.
          </Callout>

          {portals.length === 0 ? (
            <span className="small muted">Noch keine Portal-Zugänge hinterlegt.</span>
          ) : (
            <ul className="list">
              {portals.map((a) => (
                <li key={a.id} className="list-row row-between">
                  <div className="stack" style={{ gap: 3 }}>
                    <strong>{a.sourceName ?? a.siteKey}</strong>
                    {/* The portal is the heading, because that is what somebody
                        is looking for; the login is the detail underneath. With
                        several accounts on one portal — a private one and the
                        company one — the username is what tells them apart. */}
                    <span className="small muted">
                      {a.loginName ?? 'kein Benutzername hinterlegt'}
                      {a.replyToAddress ? ` · Antworten an ${a.replyToAddress}` : ''}
                    </span>
                    <span className={`lamp lamp-${accountReadiness(a)}`}>
                      <span className="lamp-dot" aria-hidden />
                      {accountLabel(a)}
                    </span>
                  </div>
                  {isAdmin ? (
                    <div className="row" style={{ gap: 6 }}>
                      <form action={verifyPortalAccountFormAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="btn sm" type="submit">
                          Prüfen
                        </button>
                      </form>
                    <form action={deleteAccountAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="btn sm ghost" type="submit">
                        Entfernen
                      </button>
                    </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {isAdmin ? <PortalAccountForm sources={sources} preselectKey={preselectPortalKey} /> : null}

          <h3 className="small" style={{ marginTop: 14 }}>
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
        </div>
      </div>

      {/* ------------------------------------------------- send settings --- */}
      <form action={saveOutboundSettingsAction} className="card" id="versand" style={{ marginTop: 18 }}>
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
              hint="Muss name+kennung@… annehmen."
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
              hint="Für das ganze Team."
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
      <form action={saveFollowUpSettingsAction} className="card" id="wiedervorlagen" style={{ marginTop: 18 }}>
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
      {/* The one mistake worth preventing here: pointing this at the address
          already used for everything. Several alerts a day per saved search
          make a working inbox unusable within a week. */}
      <Callout tone="warning">
        <strong>Eigene Adresse verwenden</strong> — z. B. <code>wohnungen@…</code>. Nicht das normale
        Firmenpostfach: die Portale schicken täglich mehrere Mails.
      </Callout>
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
function PortalAccountForm({
  sources,
  preselectKey,
}: {
  sources: Array<{ id: string; key: string; name: string }>;
  preselectKey?: string | null;
}) {
  // "Zugang hinterlegen" next to a named portal should not then ask which
  // portal it was. The key travels in the URL, so no JavaScript is involved.
  const preselected = preselectKey
    ? sources.find((s) => s.key === preselectKey || s.key.startsWith(preselectKey))?.id ?? ''
    : '';
  return (
    <form action={saveAccountFormAction} className="subcard stack" id="zugang-hinterlegen">
      <input type="hidden" name="kind" value="PORTAL" />
      <input type="hidden" name="active" value="true" />
      <strong className="small">Zugang zu einem Portal hinterlegen</strong>
      <p className="small muted" style={{ margin: 0 }}>
        Passwort wird verschlüsselt gespeichert und nie wieder angezeigt.
      </p>

      <div className="grid-3">
        <div className="field">
          <label htmlFor="accountSource">Welches Portal?</label>
          <select id="accountSource" name="sourceId" className="input" defaultValue={preselected} required>
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
            hint="Nur bei abweichender Antwortadresse."
          />
          <TextField
            idPrefix="pa-"
            name="profileUrl"
            label="Login-Adresse"
            value=""
            hint="Nur wenn abweichend."
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
