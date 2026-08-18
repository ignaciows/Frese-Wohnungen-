import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { createCandidateAction } from '@/app/actions';
import { AppBar, Crumbs, Callout } from '@/app/_components/Shell';

export const dynamic = 'force-dynamic';

export default async function NewCandidatePage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const year = new Date().getFullYear();

  return (
    <>
      <AppBar user={user} active="kandidaten" />
      <main className="container page" style={{ maxWidth: 780 }}>
        <Crumbs items={[{ label: 'Kandidaten', href: '/' }, { label: 'Neuer Kandidat' }]} />
        <div className="page-title" style={{ marginBottom: 20 }}>
          <h1>Neuer Kandidat</h1>
          <span className="sub">
            Nur das Nötigste für die Wohnungssuche. Keine Ausweise, keine Urkunden, keine medizinischen
            Unterlagen.
          </span>
        </div>

        <form action={createCandidateAction} className="card">
          <div className="card-body stack">
            {/* Der Name zuerst, weil er auf jedem Bildschirm die Überschrift
                ist. Die interne Referenz steht daneben und nicht davor: sie
                ist zum Wiederfinden im Firmen-System da, nicht zum Erkennen. */}
            <div className="grid-2">
              <div>
                <label htmlFor="displayName">Name der Kandidatin *</label>
                <input
                  id="displayName"
                  name="displayName"
                  className="input"
                  required
                  placeholder="Tanvi Gupta"
                />
                <p className="field-hint">Steht als Überschrift über dem ganzen Fall.</p>
              </div>
              <div>
                <label htmlFor="reference">Interne Referenz *</label>
                <input
                  id="reference"
                  name="reference"
                  className="input"
                  required
                  placeholder={`CAND-${year}-001`}
                />
                <p className="field-hint">Kennung aus dem Firmen-System, zum Wiederfinden.</p>
              </div>
            </div>

            <div className="grid-2">
              <div>
                <label htmlFor="contractSignedAt">Vertrag unterschrieben am</label>
                <input id="contractSignedAt" name="contractSignedAt" type="date" className="input" />
                <p className="field-hint">
                  Datum aus dem Frese-System. Ab hier läuft die Suchuhr — bestimmt die Dringlichkeit.
                </p>
              </div>
              <div>
                <label htmlFor="moveInDate">Gewünschter Einzug</label>
                <input id="moveInDate" name="moveInDate" type="date" className="input" />
                <p className="field-hint">Wichtigster Faktor für die Priorisierung.</p>
              </div>
            </div>

            <hr className="divider" />

            {/* Arbeitgeber und Arbeitsort gehören zusammen und stehen deshalb
                nebeneinander: um genau diese Adresse herum wird gesucht, und
                der Name des Trägers macht sie einordenbar, ohne sie
                nachzuschlagen. */}
            <div>
              <label htmlFor="employer">Arbeitgeber</label>
              <input
                id="employer"
                name="employer"
                className="input"
                placeholder="SLK-Kliniken Heilbronn"
              />
              <p className="field-hint">Klinik, Pflegeheim oder Träger — wo die Kandidatin arbeiten wird.</p>
            </div>

            <div>
              <label htmlFor="workplaceAddress">Arbeitsort (Adresse) *</label>
              <input
                id="workplaceAddress"
                name="workplaceAddress"
                className="input"
                required
                placeholder="Salinenstraße 2, 74906 Bad Rappenau"
              />
              <p className="field-hint">
                <strong>Um diese Adresse herum wird gesucht.</strong> Alles Weitere — Umkreis, Anfahrt,
                welche Wohnung wie gut passt — rechnet von hier aus.
              </p>
            </div>
            <div className="grid-2">
              <div>
                <label htmlFor="workplaceCity">Stadt</label>
                <input id="workplaceCity" name="workplaceCity" className="input" placeholder="Bad Rappenau" />
              </div>
              <div>
                <label htmlFor="workplacePostalCode">PLZ</label>
                <input id="workplacePostalCode" name="workplacePostalCode" className="input" placeholder="74906" />
                <p className="field-hint">Bestimmt, welche regionalen Quellen in den Suchlauf kommen.</p>
              </div>
            </div>

            <hr className="divider" />

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
              <div>
                <label htmlFor="maxCommuteMinutes">Max. Anfahrt (Min.)</label>
                <input
                  id="maxCommuteMinutes"
                  name="maxCommuteMinutes"
                  type="number"
                  className="input"
                  defaultValue={35}
                  min={1}
                  max={240}
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

            <Callout tone="info">
              Beim Anlegen wird automatisch ein erster Suchlauf geplant — mit einer Aufgabe für jede Quelle,
              die zu diesem Ort passt.
            </Callout>
          </div>
          <div className="card-foot row-between">
            <Link href="/" className="btn">
              Abbrechen
            </Link>
            <button type="submit" className="btn primary">
              Anlegen &amp; weiter zum Anschreiben →
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
