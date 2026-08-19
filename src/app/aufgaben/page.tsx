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
import { getFeatureSettings } from '@/server/settings';
import { isFeatureOn } from '@/domain/features';
import { responseStats, stalledCases } from '@/server/insights';
import { dailyWorklist } from '@/server/worklist';
import { Worklist } from '@/app/_components/Worklist';
import { describeResponseRate } from '@/domain/insights';

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

  const features = await getFeatureSettings();
  const showStalled = isFeatureOn(features, 'stalledCases');
  const showRates = isFeatureOn(features, 'responseStats');
  const showWorklist = isFeatureOn(features, 'dailyWorklist');

  const [tasks, notifications, counts, unreadReplies, failedSends, stalled, rates, worklist] =
    await Promise.all([
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
    // Beide nur rechnen, wenn sie auch gezeigt werden — ein abgeschalteter
    // Baustein soll auch keine Abfrage kosten.
    showStalled ? stalledCases() : Promise.resolve([]),
    showRates ? responseStats() : Promise.resolve(null),
    showWorklist ? dailyWorklist() : Promise.resolve(null),
  ]);

  return (
    <>
      <AppBar user={user} active="aufgaben" pending={counts.dueTasks + counts.unreadReplies} />
      <main className="container page">
        <div className="page-title" style={{ marginBottom: 18 }}>
          <h1>Aufgaben &amp; Posteingang</h1>
          <span className="sub">
            Womit heute anfangen, welche Antworten offen sind, und was schiefgegangen ist — an einem
            Ort, ohne ein einziges Portal zu öffnen.
          </span>
        </div>

        {/* Ganz oben, vor Antworten und Wiedervorlagen: das hier beantwortet
            „womit fange ich an", und alles darunter beantwortet „was ist
            außerdem noch offen". */}
        {worklist ? <Worklist list={worklist} /> : null}

        <div className="stats" style={{ marginBottom: 18 }}>
          <Stat value={unreadReplies.length} label="Ungelesene Antworten" accent={unreadReplies.length > 0} />
          <Stat value={counts.dueTasks} label="Fällige Aufgaben" accent={counts.dueTasks > 0} />
          <Stat value={failedSends.length} label="Fehlgeschlagene Anfragen" />
        </div>

        {/* Steht ein Fall still?
            Die Liste beantwortet gut, welche Wohnung als nächstes — aber nicht,
            für wen gerade gar nichts nachkommt. Ein Fall mit 200 Anzeigen,
            von denen keine passt, sieht auf jeder Liste beschäftigt aus. */}
        {showStalled && stalled.length > 0 ? (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h2>Fälle ohne passende Wohnung</h2>
              <span className="sub">
                Hier kommt nichts nach — fast immer ist das Suchprofil zu eng, nicht der Markt leer.
              </span>
            </div>
            <div className="card-body stack-sm">
              {stalled.map((c) => (
                <div key={c.candidateCaseId} className="row-between">
                  <div className="stack-sm grow">
                    <Link href={`/kandidat/${c.candidateCaseId}/profil`}>
                      <strong>{c.displayName}</strong>
                    </Link>
                    <span className="small muted">{c.reason}</span>
                  </div>
                  {c.urgency === 'high' ? <span className="badge danger">dringend</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Wird überhaupt geantwortet?
            Ohne Zahl bleibt „der Markt ist schwierig" ein Gefühl. Mit Zahl ist
            es entweder wahr oder ein Hinweis aufs Anschreiben. */}
        {showRates && rates && rates.overall.sent > 0 ? (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h2>Antwortquote</h2>
              <span className="sub">{describeResponseRate(rates.overall)}</span>
            </div>
            {rates.perSource.length > 1 ? (
              <div className="card-body table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Quelle</th>
                      <th>Angeschrieben</th>
                      <th>Beantwortet</th>
                      <th>Quote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.perSource.map((r) => (
                      <tr key={r.sourceName}>
                        <td>{r.sourceName}</td>
                        <td>{r.sent}</td>
                        <td>{r.answered}</td>
                        <td>
                          {r.ratePercent === null ? (
                            <span className="muted small">zu wenige</span>
                          ) : (
                            `${r.ratePercent} %`
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

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
