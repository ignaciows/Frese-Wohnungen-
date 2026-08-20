import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { updateCandidateAction, archiveCandidateAction, deleteCandidateAction } from '@/app/actions';
import { currentUser } from '@/lib/auth';
import { Callout } from '@/app/_components/Shell';
import { ConfirmSubmit, SubmitButton } from '@/app/_components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function StammdatenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; fehler?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await currentUser();

  const c = await prisma.candidateCase.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      displayName: true,
      searchProfile: { select: { employer: true } },
      notes: true,
      status: true,
      contractSignedAt: true,
      housingSecuredAt: true,
      createdAt: true,
    },
  });
  if (!c) notFound();

  const asDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

  return (
    <div className="stack-lg" style={{ maxWidth: 780 }}>
      {sp.saved ? <Callout tone="success">Änderungen gespeichert.</Callout> : null}
      {sp.error === 'reference-taken' ? (
        <Callout tone="danger">
          Diese Referenz ist bereits vergeben. Referenzen müssen eindeutig sein, weil Suchagent-Mails
          darüber dem richtigen Kandidaten zugeordnet werden.
        </Callout>
      ) : null}

      <form action={updateCandidateAction} className="card" autoComplete="off">
        <input type="hidden" name="candidateCaseId" value={c.id} />
        <div className="card-head">
          <h2>Stammdaten</h2>
          <span className="small subtle">Angelegt am {c.createdAt.toLocaleDateString('de-DE')}</span>
        </div>
        <div className="card-body stack">
          {/* Zwei Felder, und beide sagen, was drinsteht.
              Vorher hießen sie „Interne Referenz" und „Anzeigename", und
              genau das ging schief: in der Referenz stand der Name der
              Kandidatin, im Anzeigenamen die Praxis. Wer zwei Kästchen ohne
              erkennbaren Unterschied vor sich hat, füllt sie so aus, wie es
              für ihn Sinn ergibt — und hat recht damit. */}
          <div className="grid-2">
            <div>
              <label htmlFor="displayName">Name der Kandidatin / des Kandidaten *</label>
              <input
                id="displayName"
                name="displayName"
                className="input"
                required
                defaultValue={c.displayName}
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
                defaultValue={c.searchProfile?.employer ?? ''}
                placeholder="Klinik, Praxis oder Träger"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
              />
              <p className="field-hint">Für wen die Person arbeitet — steht in der Kopfzeile des Falls.</p>
            </div>
          </div>

          {/* Die Referenz bleibt, weil Suchagent-Mails darüber zugeordnet
              werden. Sie ist aber nichts, was jemand ausdenken muss — deshalb
              steht sie klein und zugeklappt statt als erstes Pflichtfeld. */}
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>
              Kennung für Suchagent-Mails: <span className="mono">{c.reference}</span>
            </summary>
            <div style={{ marginTop: 8 }}>
              <input id="reference" name="reference" className="input" required defaultValue={c.reference} />
              <p className="field-hint">
                Portale schicken ihre Treffer an <span className="mono">postfach+{c.reference}@…</span>.
                Wer das hier ändert, muss die Alerts im Portal anpassen.
              </p>
            </div>
          </details>

          <div className="grid-2">
            <div>
              <label htmlFor="contractSignedAt">Vertrag unterschrieben am</label>
              <input
                id="contractSignedAt"
                name="contractSignedAt"
                type="date"
                className="input"
                defaultValue={asDate(c.contractSignedAt)}
              />
              <p className="field-hint">Startet die Suchuhr — bestimmt die Dringlichkeit.</p>
            </div>
            <div>
              <label htmlFor="housingSecuredAt">Wohnung gesichert am</label>
              <input
                id="housingSecuredAt"
                name="housingSecuredAt"
                type="date"
                className="input"
                defaultValue={asDate(c.housingSecuredAt)}
              />
              <p className="field-hint">
                Gesetzt = Fall verlässt die Warteschlange und die WG-Vorschläge.
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="notes">Notizen</label>
            <textarea
              id="notes"
              name="notes"
              className="textarea"
              style={{ minHeight: 110 }}
              defaultValue={c.notes ?? ''}
              placeholder="Interne Hinweise zur Suche — keine sensiblen Personendaten."
            />
          </div>
        </div>
        <div className="card-foot row-between">
          <Link href={`/kandidat/${c.id}`} className="btn">
            Zurück
          </Link>
          <SubmitButton className="btn primary">
            Änderungen speichern
          </SubmitButton>
        </div>
      </form>

      <div className="card">
        <div className="card-head">
          <h3>Fall archivieren</h3>
        </div>
        <div className="card-body row-between">
          <p className="small muted" style={{ maxWidth: 460 }}>
            Archivierte Fälle verschwinden aus der Arbeitsliste, behalten aber Kontakt-Historie und
            Nachweise. Das ist der normale Weg, wenn eine Suche zu Ende ist.
          </p>
          <form action={archiveCandidateAction}>
            <input type="hidden" name="candidateCaseId" value={c.id} />
            <input type="hidden" name="archive" value={c.status === 'ARCHIVED' ? 'false' : 'true'} />
            <SubmitButton className="btn">
              {c.status === 'ARCHIVED' ? 'Wieder aktivieren' : 'Archivieren'}
            </SubmitButton>
          </form>
        </div>
      </div>

      {/* Löschen steht zugeklappt und hinter dem ausgeschriebenen Namen.
          Archivieren ist der Normalfall; das hier ist für den versehentlich
          angelegten Fall, die Dublette, oder wenn jemand seine Daten
          zurückverlangt. Kein Knopf, den man im Vorbeigehen trifft. */}
      {user?.role === 'ADMIN' ? (
        <details className="card danger-zone" open={sp.fehler === 'name-stimmt-nicht'}>
          <summary>
            <strong>Fall endgültig löschen</strong>
            <span className="small muted"> — kann nicht rückgängig gemacht werden</span>
          </summary>
          <div className="card-body stack">
            {sp.fehler === 'nicht-erlaubt' ? (
              <Callout tone="danger">Nur Admins können einen Fall löschen.</Callout>
            ) : null}
            <p className="small muted">
              Gelöscht werden Suchprofil, Treffer, Anfragen, Termine und Nachrichten von{' '}
              <strong>{c.displayName}</strong>. Der Eintrag im Protokoll bleibt — dass gelöscht wurde,
              ist selbst eine Tatsache, die nachlesbar bleiben muss.
            </p>
            {/* Eine Rückfrage, kein Diktat.
                Vorher musste der Anzeigename abgetippt werden. Das ist die
                Hürde, die GitHub vor das Löschen eines Repositories stellt —
                nur steht dort auch der Name, den man erwartet. Hier stand im
                Anzeigenamen die Praxis und in der Referenz die Person, und wer
                den Namen der Kandidatin eintippte, bekam „stimmt nicht" und
                kam nie durch. Eine Hürde, die die falsche Frage stellt,
                schützt nichts — sie blockiert nur.
                `confirm` läuft im Browser und hält niemanden auf, der es
                ernst meint; die eigentliche Absicherung ist das Admin-Recht
                auf dem Server, und das bleibt. */}
            <form action={deleteCandidateAction} className="row" style={{ justifyContent: 'flex-end' }}>
              <input type="hidden" name="candidateCaseId" value={c.id} />
              <ConfirmSubmit
                className="btn danger"
                question={`„${c.displayName}" wirklich endgültig löschen?`}
              >
                Fall löschen
              </ConfirmSubmit>
            </form>
          </div>
        </details>
      ) : null}
    </div>
  );
}
