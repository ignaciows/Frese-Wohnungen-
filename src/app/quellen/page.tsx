import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/auth';
import { syncCatalogAction } from '@/app/actions';
import { AppBar, Callout } from '@/app/_components/Shell';
import { INTEGRATION_MODE, formatDate } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const CATEGORY_LABEL: Record<string, string> = {
  MARKETPLACE: 'Große Portale',
  GENERAL_PORTAL: 'Weitere Portale',
  FURNISHED: 'Möbliert & Relocation',
  INSTITUTIONAL_LANDLORD: 'Große Vermieter',
  COOPERATIVE: 'Genossenschaften',
  MUNICIPAL: 'Kommunale Anbieter',
  TEMPORARY: 'Übergangswohnen',
  SOCIAL_LOCAL: 'Lokal & Sozial',
  DIRECTORY: 'Verzeichnisse',
};

export default async function QuellenRegistryPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const sources = await prisma.source.findMany({
    orderBy: [{ category: 'asc' }, { priority: 'asc' }],
    include: { _count: { select: { listings: true } }, aliases: true },
  });

  const grouped = Object.entries(
    sources.reduce<Record<string, typeof sources>>((acc, s) => {
      (acc[s.category] ??= []).push(s);
      return acc;
    }, {}),
  );

  const automated = sources.filter(
    (s) => s.integrationMode === 'OFFICIAL_API' || s.integrationMode === 'EMAIL_ALERT',
  ).length;

  return (
    <>
      <AppBar user={user} active="quellen" />
      <main className="container-wide page">
        <div className="page-head">
          <div className="page-title">
            <h1>Quellenkatalog</h1>
            <span className="sub">
              {sources.length} Quellen · {sources.filter((s) => s.active).length} aktiv. Bestimmt, welche
              Aufgaben ein Suchlauf erzeugt.
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
          <strong>Ehrliche Kennzeichnung:</strong> aktuell laufen {automated} Quellen über eine autorisierte
          Schnittstelle. Alle anderen sind Such-Link, manueller Import oder Browser-Recherche — die App
          durchsucht sie nicht selbst und speichert keine Portal-Passwörter.
        </Callout>

        <div className="stack-lg" style={{ marginTop: 22 }}>
          {grouped.map(([cat, items]) => (
            <section key={cat} className="stack">
              <div className="row">
                <h2>{CATEGORY_LABEL[cat] ?? cat}</h2>
                <span className="badge">{items.length}</span>
              </div>
              <div className="card table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Quelle</th>
                      <th>Modus</th>
                      <th>Terms geprüft</th>
                      <th>Importiert</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((s) => {
                      const mode = INTEGRATION_MODE[s.integrationMode] ?? {
                        label: s.integrationMode,
                        hint: '',
                      };
                      return (
                        <tr key={s.id}>
                          <td>
                            <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer">
                              {s.name}
                            </a>
                            {s.aliases.length > 0 ? (
                              <div className="small subtle">
                                früher: {s.aliases.map((a) => a.name).join(', ')}
                              </div>
                            ) : null}
                            {s.temporaryOnly ? (
                              <div>
                                <span className="badge warning">nur Notfall-Modus</span>
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <span className="badge">{mode.label}</span>
                            <div className="small subtle">{mode.hint}</div>
                          </td>
                          <td className="small">
                            {s.termsReviewedAt ? (
                              formatDate(s.termsReviewedAt)
                            ) : (
                              <span className="muted">offen</span>
                            )}
                          </td>
                          <td>{s._count.listings}</td>
                          <td>
                            {s.active ? (
                              <span className="badge success">aktiv</span>
                            ) : (
                              <span className="badge">inaktiv</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
