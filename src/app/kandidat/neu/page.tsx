import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { createCandidateAction } from '@/app/actions';
import { ANLEGEN_FEHLER } from './messages';
import { AppBar, Crumbs, Callout } from '@/app/_components/Shell';
import { SubmitButton } from '@/app/_components/SubmitButton';
import { AddressPicker } from '@/app/_components/AddressPicker';
import { nextFreeReference } from '@/server/candidates';
import { RadiusPicker } from '@/app/_components/RadiusPicker';

export const dynamic = 'force-dynamic';

export default async function NewCandidatePage({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/login');

  const year = new Date().getFullYear();
  // Vorbelegt, damit sich niemand eine ausdenken muss. Gezählt wurde früher,
  // wie viele Fälle es gibt — nach dem ersten gelöschten Fall zeigte das auf
  // eine Nummer, die es schon gab, und das Anlegen brach ab. Jetzt wird die
  // nächste freie gesucht, und beim Speichern noch einmal.
  const suggestedReference = await nextFreeReference(`CAND-${year}-001`);

  return (
    <>
      <AppBar user={user} active="kandidaten" />
      <main className="container page" style={{ maxWidth: 780 }}>
        <Crumbs items={[{ label: 'Kandidaten', href: '/' }, { label: 'Neuer Kandidat' }]} />
        {/* Was beim letzten Versuch schiefging — an der Stelle, an der es
            passiert ist, in einem Satz, statt als leerer Bildschirm mit einer
            Prüfziffer. Feste Kürzel, keine freien Texte aus der Adresszeile. */}
        {ANLEGEN_FEHLER[sp.fehler ?? ''] ? (
          <div style={{ marginBottom: 16 }}>
            <Callout tone="danger">{ANLEGEN_FEHLER[sp.fehler!]}</Callout>
          </div>
        ) : null}
        <div className="page-title" style={{ marginBottom: 20 }}>
          <h1>Neuer Kandidat</h1>
          <span className="sub">
            Nur das Nötigste für die Wohnungssuche. Keine Ausweise, keine Urkunden, keine medizinischen
            Unterlagen.
          </span>
        </div>

        {/* Kein Formularverlauf: der Browser hat sonst die zuletzt getippten
              Namen gespeichert und sie beim nächsten Kandidaten wieder
              angeboten — echte Namen aus anderen Fällen, in einem Menü über
              dem Feld, für jeden sichtbar, der hier gerade danebensteht. */}
        <form action={createCandidateAction} className="card" autoComplete="off">
          <div className="card-body stack">
            {/* Wer, und für wen sie arbeitet. Zusammen sind das die beiden
                Angaben, an denen ein Fall auf jedem Bildschirm erkannt wird —
                dieselbe Aufteilung wie in den Stammdaten. */}
            <div className="grid-2">
              <div>
                <label htmlFor="displayName">Name der Kandidatin *</label>
                <input
                  id="displayName"
                  name="displayName"
                  className="input"
                  required
                  placeholder="Vor- und Nachname"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                />
              </div>
              <div>
                <label htmlFor="employer">Arbeitgeber</label>
                <input
                  id="employer"
                  name="employer"
                  className="input"
                  placeholder="Klinik, Praxis oder Träger"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                />
              </div>
            </div>

            {/* Gesucht wird um diese Adresse herum, und ein Tippfehler sieht
                hier nicht wie ein Fehler aus — er sieht aus wie eine Suche, die
                still die Wohnungen der falschen Stadt zurückbringt. Deshalb
                wird die Adresse nachgeschlagen und ausgewählt; PLZ, Ort und
                Koordinaten kommen aus demselben Datensatz. */}
            <AddressPicker />

            <RadiusPicker />

            {/* Alles mit einer vertretbaren Voreinstellung. Bleibt im
                Formular, wird also weiterhin mitgeschickt — nur zugeklappt,
                damit die vier Angaben, die wirklich jetzt bekannt sein müssen,
                die Seite sind. Änderbar bleibt später alles im Suchprofil. */}
            <details className="disclosure">
              <summary>Weitere Angaben — später änderbar</summary>
              <div className="stack" style={{ marginTop: 12 }}>
                <div className="grid-2">
                  <div>
                    <label htmlFor="moveInDate">Gewünschter Einzug</label>
                    <input id="moveInDate" name="moveInDate" type="date" className="input" />
                  </div>
                  <div>
                    <label htmlFor="contractSignedAt">Vertrag unterschrieben am</label>
                    <input id="contractSignedAt" name="contractSignedAt" type="date" className="input" />
                  </div>
                </div>

            <div className="grid-2">
              <div>
                <label htmlFor="maxWarmmieteEuros">Max. Warmmiete (€)</label>
                <input
                  id="maxWarmmieteEuros"
                  name="maxWarmmieteEuros"
                  type="number"
                  className="input"
                  defaultValue={900}
                  min={100}
                  max={10000}
                />
              </div>
              </div>

            <div className="grid-4">
              <div>
                <label htmlFor="adults">Erwachsene</label>
                <input id="adults" name="adults" type="number" className="input" defaultValue={1} min={1} max={10} />
              </div>
              <div>
                <label htmlFor="children">Kinder</label>
                <input id="children" name="children" type="number" className="input" defaultValue={0} min={0} max={10} />
              </div>
              <div>
                <label htmlFor="minRooms">Min. Zimmer</label>
                <input id="minRooms" name="minRooms" type="number" step="0.5" className="input" defaultValue={1} />
              </div>
              <div>
                <label htmlFor="preferredRooms">Wunsch-Zimmer</label>
                <input
                  id="preferredRooms"
                  name="preferredRooms"
                  type="number"
                  step="0.5"
                  className="input"
                  defaultValue={2}
                />
              </div>
            </div>

            <div className="grid-2">
              <div>
                <label htmlFor="furnished">Möblierung</label>
                <select id="furnished" name="furnished" className="select" defaultValue="PREFERRED">
                  <option value="REQUIRED">Zwingend möbliert</option>
                  <option value="PREFERRED">Möbliert bevorzugt</option>
                  <option value="EITHER">Egal</option>
                </select>
              </div>
              <div>
                <label htmlFor="wbsStatus">WBS</label>
                <select id="wbsStatus" name="wbsStatus" className="select" defaultValue="NOT_AVAILABLE">
                  <option value="NOT_AVAILABLE">Nicht vorhanden</option>
                  <option value="AVAILABLE">Vorhanden</option>
                  <option value="UNKNOWN">Unbekannt</option>
                </select>
              </div>
            </div>

            <div className="checkline">
              <input id="temporaryMode" name="temporaryMode" type="checkbox" value="true" />
              <label htmlFor="temporaryMode">Notfall-/Übergangsmodus (Monteurzimmer &amp; Boardinghäuser)</label>
            </div>


                {/* Die Referenz ordnet Suchagent-Mails dem richtigen Fall zu.
                    Sie ist nichts, was jemand sich ausdenken muss — vorbelegt
                    und klein, statt als zweites Pflichtfeld ganz oben. */}
                <div>
                  <label htmlFor="reference">Kennung für Suchagent-Mails</label>
                  <input
                    id="reference"
                    name="reference"
                    className="input"
                    required
                    defaultValue={suggestedReference}
                  />
                  <p className="field-hint">
                    Portale schicken ihre Treffer an <span className="mono">postfach+kennung@…</span>.
                  </p>
                </div>
              </div>
            </details>

            <Callout tone="info">
              Beim Anlegen wird automatisch ein erster Suchlauf geplant — mit einer Aufgabe für jede Quelle,
              die zu diesem Ort passt.
            </Callout>
          </div>
          <div className="card-foot row-between">
            <Link href="/" className="btn">
              Abbrechen
            </Link>
            <SubmitButton className="btn primary">
              Anlegen &amp; weiter zum Anschreiben →
            </SubmitButton>
          </div>
        </form>
      </main>
    </>
  );
}
