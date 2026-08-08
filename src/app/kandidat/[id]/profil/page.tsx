import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { saveProfileAction } from '@/app/actions';
import { Callout } from '@/app/_components/Shell';
import { suggestedMinRooms, suggestedPreferredRooms } from '@/domain/ranking';

export const dynamic = 'force-dynamic';

export default async function ProfilPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.searchProfile.findUnique({ where: { candidateCaseId: id } });
  if (!p) notFound();

  const sugMin = suggestedMinRooms(p.adults, p.children);
  const sugPref = suggestedPreferredRooms(p.adults, p.children);

  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <form action={saveProfileAction} className="card">
        <input type="hidden" name="candidateCaseId" value={id} />
        <div className="card-head">
          <h2>Suchprofil</h2>
          <span className="small subtle">Gilt für alle Suchläufe dieses Kandidaten</span>
        </div>
        <div className="card-body stack">
          <div>
            <label htmlFor="workplaceAddress">Arbeitsort (Adresse)</label>
            <input
              id="workplaceAddress"
              name="workplaceAddress"
              className="input"
              defaultValue={p.workplaceAddress}
              required
            />
            <p className="field-hint">
              Ohne Geokodierung rechnet die App keine Entfernung aus und zeigt „Entfernung unbekannt“ — die
              Suche funktioniert trotzdem.
            </p>
          </div>

          <div className="grid-2">
            <div>
              <label htmlFor="workplaceCity">Stadt</label>
              <input id="workplaceCity" name="workplaceCity" className="input" defaultValue={p.workplaceCity ?? ''} />
            </div>
            <div>
              <label htmlFor="workplacePostalCode">PLZ</label>
              <input
                id="workplacePostalCode"
                name="workplacePostalCode"
                className="input"
                defaultValue={p.workplacePostalCode ?? ''}
              />
            </div>
          </div>

          <hr className="divider" />

          <div className="grid-2">
            <div>
              <label htmlFor="maxWarmmieteEuros">Maximale Warmmiete (€)</label>
              <input
                id="maxWarmmieteEuros"
                name="maxWarmmieteEuros"
                type="number"
                min={100}
                max={10000}
                className="input"
                defaultValue={Math.round(p.maxWarmmieteCents / 100)}
                required
              />
              <p className="field-hint">Echte Gesamtkosten, nicht Kaltmiete.</p>
            </div>
            <div>
              <label htmlFor="maxCommuteMinutes">Maximale Anfahrt (Minuten)</label>
              <input
                id="maxCommuteMinutes"
                name="maxCommuteMinutes"
                type="number"
                min={1}
                max={240}
                className="input"
                defaultValue={p.maxCommuteMinutes ?? 35}
              />
            </div>
          </div>

          <div className="grid-2">
            <div>
              <label htmlFor="minRooms">Mindest-Zimmer</label>
              <input
                id="minRooms"
                name="minRooms"
                type="number"
                step="0.5"
                min={0.5}
                className="input"
                defaultValue={p.minRooms}
                required
              />
              <p className="field-hint">
                Vorschlag für {p.adults} Erw. + {p.children} Kind(er): {sugMin}
              </p>
            </div>
            <div>
              <label htmlFor="preferredRooms">Wunsch-Zimmer</label>
              <input
                id="preferredRooms"
                name="preferredRooms"
                type="number"
                step="0.5"
                min={0.5}
                className="input"
                defaultValue={p.preferredRooms}
                required
              />
              <p className="field-hint">Vorschlag: {sugPref}</p>
            </div>
          </div>

          <div className="grid-2">
            <div>
              <label htmlFor="furnished">Möblierung</label>
              <select id="furnished" name="furnished" className="select" defaultValue={p.furnished}>
                <option value="REQUIRED">Zwingend möbliert</option>
                <option value="PREFERRED">Möbliert bevorzugt</option>
                <option value="EITHER">Egal</option>
              </select>
            </div>
            <div>
              <label htmlFor="wbsStatus">WBS (Wohnberechtigungsschein)</label>
              <select id="wbsStatus" name="wbsStatus" className="select" defaultValue={p.wbsStatus}>
                <option value="NOT_AVAILABLE">Nicht vorhanden</option>
                <option value="AVAILABLE">Vorhanden</option>
                <option value="UNKNOWN">Unbekannt</option>
              </select>
              <p className="field-hint">
                „Nicht vorhanden“ blendet WBS-pflichtige Wohnungen als nicht passend aus.
              </p>
            </div>
          </div>

          <div className="checkline">
            <input
              id="temporaryMode"
              name="temporaryMode"
              type="checkbox"
              value="true"
              defaultChecked={p.temporaryMode}
            />
            <label htmlFor="temporaryMode">
              Notfall-/Übergangsmodus — Monteurzimmer &amp; Boardinghäuser zusätzlich einbeziehen
            </label>
          </div>
        </div>
        <div className="card-foot row-between">
          <span className="small muted">Änderungen gelten ab dem nächsten Suchlauf.</span>
          <button type="submit" className="btn primary">
            Suchprofil speichern
          </button>
        </div>
      </form>

      <Callout tone="warning">
        Ein bereits laufender Suchlauf behält absichtlich sein altes Profil, damit die Historie nicht
        nachträglich verändert wird. Starte für geänderte Kriterien einen neuen Suchlauf.
      </Callout>

      <div className="row-between">
        <Link href={`/kandidat/${id}/anschreiben`} className="btn">
          ← Anschreiben
        </Link>
        <Link href={`/kandidat/${id}/quellen`} className="btn primary">
          Weiter: Quellen →
        </Link>
      </div>
    </div>
  );
}
