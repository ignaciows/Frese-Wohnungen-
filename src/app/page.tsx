import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/auth';
import { AppBar, Empty, Stat } from './_components/Shell';
import { formatDate } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const cases = await prisma.candidateCase.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    include: {
      searchProfile: true,
      applicationMessage: { select: { body: true } },
      _count: { select: { searchRuns: true, contactAttempts: true } },
      matches: { select: { status: true, compatibility: true } },
      contactAttempts: { select: { outcome: true } },
    },
  });

  const archivedCount = await prisma.candidateCase.count({ where: { status: 'ARCHIVED' } });

  const totals = {
    candidates: cases.length,
    contacted: cases.reduce((n, c) => n + c._count.contactAttempts, 0),
    positive: cases.reduce((n, c) => n + c.contactAttempts.filter((a) => a.outcome === 'POSITIVE').length, 0),
    awaiting: cases.reduce((n, c) => n + c.contactAttempts.filter((a) => a.outcome === 'AWAITING').length, 0),
  };

  return (
    <>
      <AppBar user={user} active="kandidaten" />
      <main className="container page">
        <div className="page-head">
          <div className="page-title">
            <h1>Kandidaten</h1>
            <span className="sub">
              Jeder Kandidat hat ein eigenes Suchprofil, eigene Quellen-Checkliste und eigene Kontakte.
            </span>
          </div>
          <Link href="/kandidat/neu" className="btn primary lg">
            + Neuer Kandidat
          </Link>
        </div>

        {cases.length > 0 ? (
          <div className="grid-4" style={{ marginBottom: 24 }}>
            <Stat value={totals.candidates} label="Aktive Kandidaten" />
            <Stat value={totals.contacted} label="Kontaktierte Wohnungen" />
            <Stat value={totals.positive} label="Positive Rückmeldungen" accent />
            <Stat value={totals.awaiting} label="Wartet auf Antwort" />
          </div>
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
            {cases.map((c) => {
              const contacted = c._count.contactAttempts;
              const positive = c.contactAttempts.filter((a) => a.outcome === 'POSITIVE').length;
              const awaiting = c.contactAttempts.filter((a) => a.outcome === 'AWAITING').length;
              const good = c.matches.filter(
                (m) => m.compatibility === 'COMPATIBLE' || m.compatibility === 'NEAR_MATCH',
              ).length;
              const toContact = c.matches.filter(
                (m) => m.status === 'NEW' || m.status === 'FAVORITE',
              ).length;
              const hasMessage = (c.applicationMessage?.body ?? '').trim().length > 0;
              const p = c.searchProfile;

              // What should the colleague do next on this case?
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
                        <h2>{c.displayName}</h2>
                        <span className="badge">{c.reference}</span>
                        {positive > 0 ? (
                          <span className="badge success">
                            ✓ {positive} positiv
                          </span>
                        ) : null}
                      </div>
                      <div className="row-wrap small muted">
                        <span>{p?.workplaceCity || p?.workplaceAddress || 'Kein Arbeitsort'}</span>
                        <span aria-hidden>·</span>
                        <span>
                          max. {p ? Math.round(p.maxWarmmieteCents / 100) : '—'} € warm
                        </span>
                        <span aria-hidden>·</span>
                        <span>ab {p?.minRooms ?? '—'} Zimmer</span>
                        <span aria-hidden>·</span>
                        <span>zuletzt {formatDate(c.updatedAt)}</span>
                      </div>
                      <div className="row-wrap" style={{ marginTop: 4 }}>
                        <span className="chip">
                          <strong>{c._count.searchRuns}</strong> Suchläufe
                        </span>
                        <span className="chip">
                          <strong>{good}</strong> passende Anzeigen
                        </span>
                        <span className="chip">
                          <strong>{contacted}</strong> kontaktiert
                        </span>
                        {awaiting > 0 ? (
                          <span className="chip">
                            <strong>{awaiting}</strong> Antwort offen
                          </span>
                        ) : null}
                      </div>
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
