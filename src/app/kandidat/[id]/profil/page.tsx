import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { AddressPicker } from '@/app/_components/AddressPicker';
import { RadiusPicker } from '@/app/_components/RadiusPicker';
import { saveProfileAction, saveSharingProfileAction } from '@/app/actions';
import { Callout } from '@/app/_components/Shell';
import { suggestedMinRooms, suggestedPreferredRooms } from '@/domain/ranking';
import { SubmitButton } from '@/app/_components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function ProfilPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, c] = await Promise.all([
    prisma.searchProfile.findUnique({ where: { candidateCaseId: id } }),
    prisma.candidateCase.findUnique({
      where: { id },
      select: { openToSharing: true, nationality: true, languages: true },
    }),
  ]);
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
            <label htmlFor="employer">Arbeitgeber</label>
            <input
              id="employer"
              name="employer"
              className="input"
              defaultValue={p.employer ?? ''}
              placeholder="SLK-Kliniken Heilbronn"
            />
            <p className="field-hint">Klinik, Pflegeheim oder Träger — wo die Kandidatin arbeitet.</p>
          </div>

          <div>
            {/* Dieselbe Suche wie beim Anlegen. Eine Adresse, die einmal
                falsch gespeichert wurde, muss hier zu korrigieren sein — und
                die Karte zeigt in einem Blick, ob der Ort stimmt, ohne dass
                jemand die PLZ einer fremden Stadt kennen muss. */}
            <AddressPicker
              defaultAddress={p.workplaceAddress}
              defaultCity={p.workplaceCity ?? ''}
              defaultPostalCode={p.workplacePostalCode ?? ''}
              defaultLat={p.workplaceLat}
              defaultLon={p.workplaceLon}
            />

            {/* Entfernung als Umkreis, nicht als geschätzte Fahrzeit: niemand
                weiß, was „35 Minuten" heißt, bevor er weiß, ob jemand fährt
                oder den Bus nimmt. */}
            <RadiusPicker defaultKm={p.radiusKm ?? 10} />
</div>

          <div>
            <label htmlFor="moveInDate">Gewünschter Einzug</label>
            <input
              id="moveInDate"
              name="moveInDate"
              type="date"
              className="input"
              style={{ maxWidth: 220 }}
              defaultValue={p.moveInDate ? p.moveInDate.toISOString().slice(0, 10) : ''}
            />
            <p className="field-hint">
              Treibt die Priorität dieses Kandidaten in der Warteschlange — je näher, desto dringender.
            </p>
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
          <SubmitButton className="btn primary">
            Suchprofil speichern
          </SubmitButton>
        </div>
      </form>

      <form action={saveSharingProfileAction} className="card">
        <input type="hidden" name="candidateCaseId" value={id} />
        <div className="card-head">
          <h2>WG-Bereitschaft</h2>
          <span className="small subtle">Freiwillig — nur für WG-Vorschläge</span>
        </div>
        <div className="card-body stack">
          <div className="checkline">
            <input
              id="openToSharing"
              name="openToSharing"
              type="checkbox"
              value="true"
              defaultChecked={c?.openToSharing ?? false}
            />
            <label htmlFor="openToSharing">
              Kandidat:in ist offen dafür, sich eine Wohnung mit einer anderen Pflegekraft zu teilen
            </label>
          </div>
          <p className="field-hint">
            Nur ankreuzen, wenn das vorher wirklich abgefragt wurde. Ohne Häkchen erscheint diese Person in
            keinem WG-Vorschlag.
          </p>

          <div className="grid-2">
            <div>
              <label htmlFor="nationality">Herkunftsland (optional)</label>
              <input
                id="nationality"
                name="nationality"
                className="input"
                defaultValue={c?.nationality ?? ''}
                placeholder="z. B. Indien"
              />
            </div>
            <div>
              <label htmlFor="languages">Sprachen (optional)</label>
              <input
                id="languages"
                name="languages"
                className="input"
                defaultValue={c?.languages ?? ''}
                placeholder="z. B. Hindi, Englisch"
              />
            </div>
          </div>
          <p className="field-hint">
            Wird ausschließlich für WG-Vorschläge verwendet und kann in den Einstellungen komplett
            abgeschaltet werden. Leer lassen, wenn nicht benötigt.
          </p>
        </div>
        <div className="card-foot" style={{ textAlign: 'right' }}>
          <SubmitButton className="btn">
            WG-Angaben speichern
          </SubmitButton>
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
