import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { createCandidateAction } from '@/app/actions';
import { AppBar, Crumbs } from '@/app/_components/Shell';
import { AddressPicker } from '@/app/_components/AddressPicker';
import { RadiusPicker } from '@/app/_components/RadiusPicker';

export const dynamic = 'force-dynamic';

/**
 * Creating a candidate asked sixteen questions before it would do anything.
 *
 * Fourteen of them have a sensible default and can be changed later on the
 * Suchprofil page, where they belong — they are search *settings*, not facts
 * about the person. Asked up front they turned "add the new nurse" into a form
 * somebody puts off until they have half an hour.
 *
 * Four things genuinely have to be known now: who it is, how the company refers
 * to them, where they will work, and how far from there they will live. The
 * rest is behind one disclosure, filled in with defaults, and the page still
 * posts every field so nothing is lost.
 */
export default async function NewCandidatePage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const year = new Date().getFullYear();

  return (
    <>
      <AppBar user={user} active="kandidaten" />
      <main className="container page" style={{ maxWidth: 720 }}>
        <Crumbs items={[{ label: 'Kandidaten', href: '/' }, { label: 'Neuer Kandidat' }]} />
        <div className="page-title" style={{ marginBottom: 20 }}>
          <h1>Neuer Kandidat</h1>
        </div>

        <form action={createCandidateAction} className="card">
          <div className="card-body stack">
            <div className="grid-2">
              <div className="field">
                <label htmlFor="displayName">Name der Kandidatin</label>
                <input
                  id="displayName"
                  name="displayName"
                  className="input"
                  required
                  placeholder="Khaoula Mgaidi"
                  autoComplete="off"
                />
              </div>
              <div className="field">
                <label htmlFor="reference">Interne Referenz</label>
                <input
                  id="reference"
                  name="reference"
                  className="input"
                  required
                  placeholder={`CAND-${year}-001`}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="employerName">Arbeitgeber</label>
              <input
                id="employerName"
                name="employerName"
                className="input"
                placeholder="SLK-Kliniken Heilbronn"
                autoComplete="off"
              />
            </div>

            <AddressPicker />

            <RadiusPicker />

            {/* Everything with a defensible default. Kept in the form so the
                values still post; folded away so the four that matter are the
                page. All of it is editable later under Suchprofil. */}
            <details className="disclosure">
              <summary>Weitere Angaben — später änderbar</summary>
              <div className="stack" style={{ marginTop: 12 }}>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="moveInDate">Gewünschter Einzug</label>
                    <input id="moveInDate" name="moveInDate" type="date" className="input" />
                  </div>
                  <div className="field">
                    <label htmlFor="contractSignedAt">Vertrag unterschrieben am</label>
                    <input id="contractSignedAt" name="contractSignedAt" type="date" className="input" />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="field">
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
                  <div className="field">
                    <label htmlFor="minRooms">Min. Zimmer</label>
                    <input
                      id="minRooms"
                      name="minRooms"
                      type="number"
                      step="0.5"
                      className="input"
                      defaultValue={1}
                    />
                  </div>
                </div>

                <div className="grid-4">
                  <div className="field">
                    <label htmlFor="adults">Erwachsene</label>
                    <input id="adults" name="adults" type="number" className="input" defaultValue={1} min={1} max={10} />
                  </div>
                  <div className="field">
                    <label htmlFor="children">Kinder</label>
                    <input id="children" name="children" type="number" className="input" defaultValue={0} min={0} max={10} />
                  </div>
                  <div className="field">
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
                  <div className="field">
                    <label htmlFor="wbsStatus">WBS</label>
                    <select id="wbsStatus" name="wbsStatus" className="input" defaultValue="NOT_AVAILABLE">
                      <option value="NOT_AVAILABLE">Nein</option>
                      <option value="AVAILABLE">Ja</option>
                      <option value="UNKNOWN">Unbekannt</option>
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="furnished">Möblierung</label>
                  <select id="furnished" name="furnished" className="input" defaultValue="PREFERRED">
                    <option value="REQUIRED">Zwingend möbliert</option>
                    <option value="PREFERRED">Möbliert bevorzugt</option>
                    <option value="EITHER">Egal</option>
                  </select>
                </div>

                <div className="checkline">
                  <input id="temporaryMode" name="temporaryMode" type="checkbox" value="true" />
                  <label htmlFor="temporaryMode">Auch Monteurzimmer &amp; Boardinghäuser</label>
                </div>
              </div>
            </details>
          </div>

          <div className="card-foot row-between">
            <Link href="/" className="btn">
              Abbrechen
            </Link>
            <button type="submit" className="btn primary lg">
              Anlegen →
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
