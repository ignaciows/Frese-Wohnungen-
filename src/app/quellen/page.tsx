/**
 * "Woher kommen die Wohnungen eigentlich?" — auf einer Seite beantwortet.
 *
 * Es gibt drei Quellen und zwei Wege, auf denen sie hereinkommen. Mehr steht
 * hier bewusst nicht: die Seite hatte einmal fünfzig Zeilen in neun Kategorien,
 * und niemand hat je etwas darauf gefunden.
 */

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { inboxCounts } from '@/server/followUps';
import { currentUser } from '@/lib/auth';
import { syncCatalogAction } from '@/app/actions';
import { AppBar, Callout } from '@/app/_components/Shell';
import { SOURCE_ROUTE, formatDateTime } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function QuellenRegistryPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const pending = await inboxCounts();

  const sources = await prisma.source.findMany({
    where: { active: true },
    orderBy: { priority: 'asc' },
    include: { _count: { select: { listings: true } } },
  });

  return (
    <>
      <AppBar user={user} active="quellen" pending={pending.dueTasks + pending.unreadReplies} />
      <main className="container-wide page">
        <div className="page-head">
          <div className="page-title">
            <h1>Quellen</h1>
            <span className="sub">
              Drei Portale. Praktisch jede Wohnung, die dieses Werkzeug findet, kommt von einem davon.
            </span>
          </div>
          {user.role === 'ADMIN' ? (
            <form action={syncCatalogAction}>
              <button type="submit" className="btn">
                Katalog neu einlesen
              </button>
            </form>
          ) : null}
        </div>

        <Callout tone="info">
          <strong>Kleinanzeigen</strong> liest die App selbst — robots.txt-konform, mit Pausen und echter
          Kennung. <strong>ImmoScout24</strong> und <strong>Immowelt</strong> sperren automatische Abrufe;
          dort legt ihr im Portal einen Suchauftrag an, der neue Treffer an das gemeinsame Postfach
          schickt. Die Einrichtung steht in <code>docs/QUELLEN.md</code>. Bot-Sperren werden protokolliert,
          nicht umgangen.
        </Callout>

        <div className="card table-wrap" style={{ marginTop: 22 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Quelle</th>
                <th>Weg</th>
                <th>Anzeigen</th>
                <th>Zuletzt gelesen</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const route = SOURCE_ROUTE[s.route] ?? { label: s.route, hint: '', tone: 'neutral' as const };
                return (
                  <tr key={s.id}>
                    <td>
                      <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer">
                        {s.name}
                      </a>
                      {s.notes ? <div className="small subtle">{s.notes}</div> : null}
                    </td>
                    <td>
                      <span className={`badge ${route.tone}`}>{route.label}</span>
                      <div className="small subtle">{route.hint}</div>
                    </td>
                    <td>{s._count.listings}</td>
                    <td className="small">
                      {s.lastDiscoveredAt ? (
                        formatDateTime(s.lastDiscoveredAt)
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
