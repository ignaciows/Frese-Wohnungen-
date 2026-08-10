import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { inboxCounts } from '@/server/followUps';
import { currentUser } from '@/lib/auth';
import { loadCandidatePriorities } from '@/server/priority';
import { AppBar, Empty, Stat, Callout } from './_components/Shell';
import { formatDate, PRIORITY_TIER, difficultyLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const pending = await inboxCounts();

  const [cases, priorities, archivedCount] = await Promise.all([
    prisma.candidateCase.findMany({
      where: { status: 'ACTIVE' },
      include: {
        searchProfile: true,
        applicationMessage: { select: { body: true } },
        _count: { select: { searchRuns: true, contactAttempts: true } },
        matches: { select: { status: true, compatibility: true } },
        contactAttempts: { select: { outcome: true } },
      },
    }),
    loadCandidatePriorities(),
    prisma.candidateCase.count({ where: { status: 'ARCHIVED' } }),
  ]);

  const byId = new Map(cases.map((c) => [c.id, c]));
  // Priority order decides the work queue.
  const ordered = priorities.map((p) => ({ p, c: byId.get(p.candidateCaseId)! })).filter((x) => x.c);

  const totals = {
    candidates: cases.length,
    contacted: cases.reduce((n, c) => n + c._count.contactAttempts, 0),
    positive: cases.reduce((n, c) => n + c.contactAttempts.filter((a) => a.outcome === 'POSITIVE').length, 0),
    openAnfragen: priorities.reduce((n, p) => n + p.remainingContacts, 0),
  };
  const critical = priorities.filter((p) => p.tier === 'CRITICAL').length;

  return (
    <>
      <AppBar user={user} active="kandidaten" pending={pending.dueTasks + pending.unreadReplies} />
      <main className="container page">
        <div className="page-head">
          <div className="page-title">
            <h1>Kandidaten</h1>
            <span className="sub">
              Sortiert nach Dringlichkeit: Einzugstermin, Wartezeit seit Vertragsunterschrift und wie
              schwierig der Zielmarkt ist.
            </span>
          </div>
          <Link href="/kandidat/neu" className="btn primary lg">
            + Neuer Kandidat
          </Link>
        </div>

        {cases.length > 0 ? (
          <>
            <div className="grid-4" style={{ marginBottom: 16 }}>
              <Stat value={totals.candidates} label="Aktive Kandidaten" />
              <Stat value={totals.contacted} label="Anfragen gesendet" />
              <Stat value={totals.positive} label="Positive Rückmeldungen" accent />
              <Stat value={totals.openAnfragen} label="Offene Anfragen (Soll)" />
            </div>
            {critical > 0 ? (
              <div style={{ marginBottom: 20 }}>
                <Callout tone="danger">
                  <strong>
                    {critical} {critical === 1 ? 'Kandidat ist' : 'Kandidaten sind'} kritisch.
                  </strong>{' '}
                  Kurzer Einzugstermin oder schwieriger Markt bei zu wenigen Anfragen — zuerst hier arbeiten.
                </Callout>
              </div>
            ) : null}
          </>
        ) : null}

        {cases.length === 0 ? (
          <div className="card">
            <Empty
              icon="+"
              title="Noch kein Kandidat angelegt"
              action={
                <Link href="/kandidat/neu" className="btn primary">
                  Ersten Kandidaten anlegen
                </Link>
              }
            >
              Lege einen Kandidatenfall an — danach führt dich die App Schritt für Schritt durch Anschreiben,
              Suchprofil, Quellen und Kontakte.
            </Empty>
          </div>
        ) : (
          <div className="stack">
            {ordered.map(({ p, c }) => {
              const positive = c.contactAttempts.filter((a) => a.outcome === 'POSITIVE').length;
              const awaiting = c.contactAttempts.filter((a) => a.outcome === 'AWAITING').length;
              const good = c.matches.filter(
                (m) => m.compatibility === 'COMPATIBLE' || m.compatibility === 'NEAR_MATCH',
              ).length;
              const toContact = c.matches.filter((m) => m.status === 'NEW' || m.status === 'FAVORITE').length;
              const hasMessage = (c.applicationMessage?.body ?? '').trim().length > 0;
              const tier = PRIORITY_TIER[p.tier];
              const pct = p.targetContacts
                ? Math.min(100, Math.round((p.contactsSent / p.targetContacts) * 100))
                : 0;

              let next = { label: 'Ergebnisse ansehen', href: `/kandidat/${c.id}/ergebnisse` };
              if (!hasMessage) next = { label: 'Anschreiben einfügen', href: `/kandidat/${c.id}/anschreiben` };
              else if (c._count.searchRuns === 0) next = { label: 'Suchlauf starten', href: `/kandidat/${c.id}/quellen` };
              else if (c.matches.length === 0) next = { label: 'Anzeigen importieren', href: `/kandidat/${c.id}/quellen` };
              else if (toContact > 0) next = { label: `${toContact} zu kontaktieren`, href: `/kandidat/${c.id}/ergebnisse` };
              else if (awaiting > 0) next = { label: `${awaiting} Antwort offen`, href: `/kandidat/${c.id}/kontakte` };

              return (
                <Link key={c.id} href={`/kandidat/${c.id}`} className="card card-link card-pad">
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div className="grow stack-sm">
                      <div className="row-wrap">
                        {/* The word carries the judgement; "· 76" alongside it
                            invites the reader to work out what 76 means, and
                            nothing on this screen tells them. */}
                        <span className={`badge ${tier.tone}`} title={`Dringlichkeit ${Math.round(p.score)}/100`}>
                          {tier.icon} {tier.label}
                        </span>
                        <h2>{c.displayName}</h2>
                        <span className="badge">{c.reference}</span>
                        {positive > 0 ? <span className="badge success">✓ {positive} positiv</span> : null}
                      </div>

                      <div className="row-wrap small muted">
                        <span>{c.searchProfile?.workplaceCity || c.searchProfile?.workplaceAddress || '—'}</span>
                        <span aria-hidden>·</span>
                        <span title={`Marktschwierigkeit ${Math.round(p.market.difficulty)}/100`}>
                          Markt {difficultyLabel(p.market.difficulty)}
                        </span>
                        <span aria-hidden>·</span>
                        <span>seit {p.daysWaiting} Tagen in Suche</span>
                        {p.daysUntilMoveIn != null ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>
                              {p.daysUntilMoveIn <= 0
                                ? 'Einzug überfällig'
                                : `Einzug in ${p.daysUntilMoveIn} Tagen`}
                            </span>
                          </>
                        ) : null}
                      </div>

                      {/* Anfrage target derived from how hard this market is. */}
                      <div style={{ maxWidth: 420, marginTop: 2 }}>
                        <div className="progress" aria-label={`${p.contactsSent} von ${p.targetContacts}`}>
                          <div className="progress-bar" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="small muted" style={{ marginTop: 4 }}>
                          <strong>{p.contactsSent}</strong> von <strong>{p.targetContacts}</strong> empfohlenen
                          Anfragen
                          {p.remainingContacts > 0 ? ` · noch ${p.remainingContacts} offen` : ' · Soll erreicht'}
                        </div>
                      </div>

                      <div className="row-wrap" style={{ marginTop: 4 }}>
                        <span className="chip">
                          <strong>{good}</strong> passende Anzeigen
                        </span>
                        <span className="chip">
                          <strong>{c._count.contactAttempts}</strong> kontaktiert
                        </span>
                        <span className="chip">zuletzt {formatDate(c.updatedAt)}</span>
                      </div>

                      {/* The reasons were "35 Tage bis zum Einzug · Seit 24
                          Tagen in der Suche" — the same two facts already
                          printed two lines above, in the same card. */}
                    </div>

                    <span className="btn soft nowrap">{next.label} →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {archivedCount > 0 ? (
          <p className="small muted" style={{ marginTop: 20 }}>
            {archivedCount} archivierte{archivedCount === 1 ? 'r Fall' : ' Fälle'} ausgeblendet.
          </p>
        ) : null}
      </main>
    </>
  );
}
