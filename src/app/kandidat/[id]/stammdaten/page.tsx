import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { updateCandidateAction, archiveCandidateAction, deleteCandidateAction } from '@/app/actions';
import { currentUser } from '@/lib/auth';
import { Callout } from '@/app/_components/Shell';

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

      <form action={updateCandidateAction} className="card">
        <input type="hidden" name="candidateCaseId" value={c.id} />
        <div className="card-head">
          <h2>Stammdaten</h2>
          <span className="small subtle">Angelegt am {c.createdAt.toLocaleDateString('de-DE')}</span>
        </div>
        <div className="card-body stack">
          <div className="grid-2">
            <div>
              <label htmlFor="reference">Interne Referenz *</label>
              <input id="reference" name="reference" className="input" required defaultValue={c.reference} />
              <p className="field-hint">
                Wird für die Zuordnung von Suchagent-Mails benutzt
                (<span className="mono">postfach+{c.reference}@…</span>). Beim Ändern die Alerts anpassen.
              </p>
            </div>
            <div>
              <label htmlFor="displayName">Anzeigename *</label>
              <input
                id="displayName"
                name="displayName"
                className="input"
                required
                defaultValue={c.displayName}
              />
            </div>
          </div>

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
          <button type="submit" className="btn primary">
            Änderungen speichern
          </button>
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
            <button type="submit" className="btn">
              {c.status === 'ARCHIVED' ? 'Wieder aktivieren' : 'Archivieren'}
            </button>
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
            {/* Aufgeklappt, wenn hier etwas schiefging — eine Fehlermeldung in
                einem zugeklappten Abschnitt liest niemand, und der Versuch
                sähe aus, als wäre einfach nichts passiert. */}
            {sp.fehler === 'name-stimmt-nicht' ? (
              <Callout tone="danger">Zum Löschen den Namen exakt eingeben.</Callout>
            ) : null}
            <p className="small muted">
              Gelöscht werden Suchprofil, Treffer, Anfragen, Termine und Nachrichten dieses Falls. Der
              Eintrag im Protokoll bleibt — dass gelöscht wurde, ist selbst eine Tatsache, die nachlesbar
              bleiben muss.
            </p>
            <form action={deleteCandidateAction} className="stack-sm">
              <input type="hidden" name="candidateCaseId" value={c.id} />
              <label htmlFor="confirmName">
                Zum Bestätigen den Namen eingeben: <strong>{c.displayName}</strong>
              </label>
              <input
                id="confirmName"
                name="confirmName"
                className="input"
                autoComplete="off"
                placeholder={c.displayName}
                required
              />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" className="btn danger">
                  Endgültig löschen
                </button>
              </div>
            </form>
          </div>
        </details>
      ) : null}
    </div>
  );
}
