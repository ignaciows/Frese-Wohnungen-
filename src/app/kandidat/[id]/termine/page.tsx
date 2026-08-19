import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createAppointmentAction, setAppointmentOutcomeAction, deleteAppointmentAction } from '@/app/actions';
import { Empty, Callout } from '@/app/_components/Shell';
import { formatDateTime } from '@/lib/labels';
import { featureOn } from '@/server/settings';

export const dynamic = 'force-dynamic';

const KIND: Record<string, { label: string; icon: string }> = {
  VIDEO_CALL: { label: 'Videocall', icon: '📹' },
  VIEWING: { label: 'Besichtigung', icon: '🏠' },
  PHONE_CALL: { label: 'Telefonat', icon: '📞' },
  HANDOVER: { label: 'Übergabe', icon: '🔑' },
  OTHER: { label: 'Sonstiges', icon: '•' },
};

const STATUS: Record<string, { label: string; tone: string }> = {
  SCHEDULED: { label: 'Geplant', tone: 'info' },
  DONE_POSITIVE: { label: 'Gut gelaufen', tone: 'success' },
  DONE_NEGATIVE: { label: 'Nicht gut gelaufen', tone: 'danger' },
  CANCELLED: { label: 'Abgesagt', tone: 'neutral' },
  NO_SHOW: { label: 'Nicht erschienen', tone: 'warning' },
};

export default async function TerminePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Erst anmelden, dann erst verraten, ob es die Seite überhaupt gibt.
  // Der Reiter ist ohne den Baustein schon aus der Navigation verschwunden;
  // die Seite muss trotzdem selbst zumachen, sonst reicht ein Lesezeichen und
  // die abgeschaltete Funktion steht wieder da.
  if (!(await currentUser())) redirect('/login');
  if (!(await featureOn('appointments'))) notFound();

  const [appointments, contactedListings] = await Promise.all([
    prisma.appointment.findMany({
      where: { candidateCaseId: id },
      orderBy: { scheduledAt: 'asc' },
      include: { listing: { select: { id: true, title: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.contactAttempt.findMany({
      where: { candidateCaseId: id },
      select: { listing: { select: { id: true, title: true } } },
    }),
  ]);

  const now = Date.now();
  const upcoming = appointments.filter((a) => a.status === 'SCHEDULED' && a.scheduledAt.getTime() >= now);
  const past = appointments.filter((a) => a.status !== 'SCHEDULED' || a.scheduledAt.getTime() < now);

  return (
    <div className="stack-lg" style={{ maxWidth: 900 }}>
      <form action={createAppointmentAction} className="card">
        <div className="card-head">
          <h2>Termin planen</h2>
        </div>
        <div className="card-body stack">
          <input type="hidden" name="candidateCaseId" value={id} />
          <div className="grid-3">
            <div>
              <label htmlFor="kind">Art</label>
              <select id="kind" name="kind" className="select" defaultValue="VIEWING">
                {Object.entries(KIND).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="scheduledAt">Datum &amp; Uhrzeit *</label>
              <input id="scheduledAt" name="scheduledAt" type="datetime-local" className="input" required />
            </div>
            <div>
              <label htmlFor="durationMinutes">Dauer (Min.)</label>
              <input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                className="input"
                defaultValue={30}
                min={5}
                max={600}
              />
            </div>
          </div>
          <div className="grid-2">
            <div>
              <label htmlFor="listingId">Wohnung (optional)</label>
              <select id="listingId" name="listingId" className="select" defaultValue="">
                <option value="">— keine bestimmte Wohnung —</option>
                {contactedListings.map((c) => (
                  <option key={c.listing.id} value={c.listing.id}>
                    {c.listing.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="location">Ort oder Meeting-Link</label>
              <input id="location" name="location" className="input" placeholder="Adresse oder https://…" />
            </div>
          </div>
          <div>
            <label htmlFor="notes">Notiz</label>
            <input id="notes" name="notes" className="input" placeholder="Worum geht es?" />
          </div>
        </div>
        <div className="card-foot row-between">
          <span className="small muted">
            Termine leben nur in diesem Tool — es wird nichts in einen externen Kalender geschrieben.
          </span>
          <button type="submit" className="btn primary">
            Termin anlegen
          </button>
        </div>
      </form>

      <section className="stack">
        <div className="row">
          <h2>Anstehend</h2>
          <span className="badge">{upcoming.length}</span>
        </div>
        {upcoming.length === 0 ? (
          <div className="card">
            <Empty icon="🗓" title="Keine anstehenden Termine" />
          </div>
        ) : (
          <div className="stack">
            {upcoming.map((a) => (
              <div key={a.id} className="card card-pad">
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="grow stack-sm">
                    <div className="row-wrap">
                      <h3>
                        {KIND[a.kind].icon} {KIND[a.kind].label}
                      </h3>
                      <span className="badge info">{formatDateTime(a.scheduledAt)}</span>
                      {a.durationMinutes ? <span className="chip">{a.durationMinutes} Min.</span> : null}
                    </div>
                    {a.listing ? <div className="small muted">{a.listing.title}</div> : null}
                    {a.location ? (
                      <div className="small">
                        {a.location.startsWith('http') ? (
                          <a href={a.location} target="_blank" rel="noopener noreferrer">
                            Meeting öffnen ↗
                          </a>
                        ) : (
                          a.location
                        )}
                      </div>
                    ) : null}
                    {a.notes ? <div className="small subtle">{a.notes}</div> : null}
                  </div>
                  <form action={deleteAppointmentAction}>
                    <input type="hidden" name="appointmentId" value={a.id} />
                    <button type="submit" className="btn ghost sm">
                      Löschen
                    </button>
                  </form>
                </div>

                <div className="row-wrap" style={{ marginTop: 12 }}>
                  {(['DONE_POSITIVE', 'DONE_NEGATIVE', 'NO_SHOW', 'CANCELLED'] as const).map((s) => (
                    <form key={s} action={setAppointmentOutcomeAction}>
                      <input type="hidden" name="appointmentId" value={a.id} />
                      <input type="hidden" name="status" value={s} />
                      <button type="submit" className="btn sm">
                        {STATUS[s].label}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {past.length > 0 ? (
        <section className="stack">
          <h2>Vergangen</h2>
          <div className="card">
            {past.map((a) => (
              <div key={a.id} className="listing" style={{ gridTemplateColumns: '1fr auto' }}>
                <span className="listing-main">
                  <span className="listing-title">
                    {KIND[a.kind].icon} {KIND[a.kind].label}
                    {a.listing ? ` — ${a.listing.title}` : ''}
                  </span>
                  <span className="small muted">
                    {formatDateTime(a.scheduledAt)} · angelegt von {a.createdBy.name}
                  </span>
                  {a.outcomeNote ? <span className="small subtle">{a.outcomeNote}</span> : null}
                </span>
                <span className={`badge ${STATUS[a.status].tone}`}>{STATUS[a.status].label}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Callout tone="info">
        Ein gut gelaufener Termin ist der Moment, das Ergebnis auch im Firmen-System zu hinterlegen — die
        drei Felder dafür stehen unter „Kontakte“.
      </Callout>
    </div>
  );
}
