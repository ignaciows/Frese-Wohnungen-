import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AppBar, Callout, Empty, Stat } from '@/app/_components/Shell';
import { listDueTasks, listNotifications, inboxCounts } from '@/server/followUps';
import {
  completeTaskAction,
  markNotificationsReadAction,
  markRepliesReadAction,
  retrySendFormAction,
} from '@/app/actions';
import { formatDateTime } from '@/lib/labels';

export const dynamic = 'force-dynamic';

/**
 * One screen that answers "what do I have to do right now?".
 *
 * Three lists, ordered by how much they cost to ignore: replies waiting to be
 * read, reminders that have come due, and anything that failed to send. The
 * point is that none of these require opening a portal inbox.
 */
export default async function AufgabenPage({
  searchParams,
}: {
  searchParams: Promise<{ alle?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const sp = await searchParams;
  const showFuture = sp.alle === '1';

  const [tasks, notifications, counts, unreadReplies, failedSends] = await Promise.all([
    listDueTasks({ includeFuture: showFuture }),
    listNotifications(20),
    inboxCounts(),
    prisma.contactMessage.findMany({
      where: { direction: 'INCOMING', readAt: null },
      orderBy: { occurredAt: 'desc' },
      take: 50,
      include: {
        contactAttempt: {
          select: {
            id: true,
            candidateCaseId: true,
            candidateCase: { select: { displayName: true, reference: true } },
            listing: { select: { title: true, canonicalUrl: true } },
          },
        },
      },
    }),
    prisma.contactAttempt.findMany({
      where: { deliveryStatus: 'FAILED' },
      orderBy: { contactedAt: 'desc' },
      take: 20,
      include: {
        listing: { select: { title: true } },
        candidateCase: { select: { id: true, displayName: true } },
      },
    }),
  ]);

  return (
    <>
      <AppBar user={user} active="aufgaben" pending={counts.dueTasks + counts.unreadReplies} />
      <main className="container page">
        <div className="page-title" style={{ marginBottom: 18 }}>
          <h1>Aufgaben &amp; Posteingang</h1>
          <span className="sub">
            Antworten, Wiedervorlagen und Fehlversuche an einem Ort — ohne ein einziges Portal zu öffnen.
          </span>
        </div>

        <div className="stats" style={{ marginBottom: 18 }}>
          <Stat value={unreadReplies.length} label="Ungelesene Antworten" accent={unreadReplies.length > 0} />
          <Stat value={counts.dueTasks} label="Fällige Aufgaben" accent={counts.dueTasks > 0} />
          <Stat value={failedSends.length} label="Fehlgeschlagene Anfragen" />
        </div>

        {/* -------------------------------------------------- replies --- */}
        <section className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Neue Antworten</h2>
            <span className="sub">Automatisch aus dem Postfach zugeordnet.</span>
          </div>
          <div className="card-body">
            {unreadReplies.length === 0 ? (
              <Empty icon="✉" title="Keine ungelesenen Antworten">
                Sobald ein Vermieter antwortet, erscheint die Nachricht hier — die Zuordnung passiert über
                eine eindeutige Kennung in der Antwortadresse.
              </Empty>
            ) : (
              <ul className="list">
                {unreadReplies.map((m) => (
                  <li key={m.id} className="list-row stack" style={{ gap: 6 }}>
                    <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                      <strong>{m.contactAttempt.listing.title}</strong>
                      <span className="badge">{m.contactAttempt.candidateCase.reference}</span>
                      <span className="small muted">{formatDateTime(m.occurredAt)}</span>
                    </div>
                    {m.fromAddress ? <div className="small muted">Von: {m.fromAddress}</div> : null}
                    <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                      {m.body.slice(0, 600)}
                    </p>
                    <div className="row" style={{ gap: 8 }}>
                      <Link
                        className="btn sm"
                        href={`/kandidat/${m.contactAttempt.candidateCaseId}/kontakte`}
                      >
                        Verlauf öffnen
                      </Link>
                      <form action={markRepliesReadAction}>
                        <input type="hidden" name="contactAttemptId" value={m.contactAttempt.id} />
                        <button className="btn sm ghost" type="submit">
                          Als gelesen markieren
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------- tasks --- */}
        <section className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>{showFuture ? 'Alle offenen Aufgaben' : 'Fällige Aufgaben'}</h2>
            <div className="grow" />
            <Link className="btn sm ghost" href={showFuture ? '/aufgaben' : '/aufgaben?alle=1'}>
              {showFuture ? 'Nur fällige' : 'Auch künftige zeigen'}
            </Link>
          </div>
          <div className="card-body">
            {tasks.length === 0 ? (
              <Empty icon="✓" title="Nichts offen">
                Wiedervorlagen entstehen automatisch, sobald eine Anfrage rausgeht.
              </Empty>
            ) : (
              <ul className="list">
                {tasks.map((t) => (
                  <li key={t.id} className="list-row stack" style={{ gap: 6 }}>
                    <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                      <strong>{t.title}</strong>
                      {t.overdueDays > 0 ? (
                        <span className="badge danger">{t.overdueDays} Tage überfällig</span>
                      ) : (
                        <span className="badge">fällig {formatDateTime(t.dueAt)}</span>
                      )}
                    </div>
                    <div className="small muted">
                      {t.candidateName}
                      {t.awaitingSince != null ? ` · seit ${t.awaitingSince} Tagen ohne Antwort` : ''}
                    </div>
                    {t.note ? <div className="small">{t.note}</div> : null}
                    <div className="row" style={{ gap: 8 }}>
                      <Link className="btn sm" href={`/kandidat/${t.candidateCaseId}/kontakte`}>
                        Verlauf öffnen
                      </Link>
                      <form action={completeTaskAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="state" value="DONE" />
                        <button className="btn sm" type="submit">
                          Erledigt
                        </button>
                      </form>
                      <form action={completeTaskAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="state" value="DISMISSED" />
                        <button className="btn sm ghost" type="submit">
                          Verwerfen
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* --------------------------------------------- failed sends --- */}
        {failedSends.length > 0 ? (
          <section className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <h2>Nicht zugestellt</h2>
            </div>
            <div className="card-body stack">
              <Callout tone="warning">
                Diese Anfragen sind erfasst, aber nicht rausgegangen. Der Vermieter hat also noch nichts von
                uns gehört.
              </Callout>
              <ul className="list">
                {failedSends.map((a) => (
                  <li key={a.id} className="list-row stack" style={{ gap: 6 }}>
                    <strong>{a.listing.title}</strong>
                    <div className="small muted">
                      {a.candidateCase.displayName} · {a.deliveryError}
                    </div>
                    <form action={retrySendFormAction}>
                      <input type="hidden" name="contactAttemptId" value={a.id} />
                      <button className="btn sm" type="submit">
                        Erneut senden
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* -------------------------------------------- notifications --- */}
        <section className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h2>Meldungen</h2>
            <div className="grow" />
            {counts.notifications > 0 ? (
              <form action={markNotificationsReadAction}>
                <button className="btn sm ghost" type="submit">
                  Alle als gelesen
                </button>
              </form>
            ) : null}
          </div>
          <div className="card-body">
            {notifications.length === 0 ? (
              <Empty icon="•" title="Keine Meldungen" />
            ) : (
              <ul className="list">
                {notifications.map((n) => (
                  <li key={n.id} className="list-row">
                    <div className="stack" style={{ gap: 3 }}>
                      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                        {!n.readAt ? <span className="badge accent">neu</span> : null}
                        <strong>{n.title}</strong>
                        <span className="small muted">{formatDateTime(n.createdAt)}</span>
                      </div>
                      {n.body ? <div className="small muted">{n.body.slice(0, 200)}</div> : null}
                      {n.url ? (
                        <Link className="small" href={n.url}>
                          Öffnen
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
