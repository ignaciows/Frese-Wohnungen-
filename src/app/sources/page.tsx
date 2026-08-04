import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { TopBar } from '../_components/TopBar';
import { syncCatalogAction } from '../actions';

export default async function SourcesPage() {
  const user = await requireUser();
  const cases = await prisma.candidateCase.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, reference: true, displayName: true, status: true },
  });
  const sources = await prisma.source.findMany({
    include: { family: true, aliases: true, coverage: true, filterMappings: true },
    orderBy: [{ active: 'desc' }, { priority: 'asc' }, { name: 'asc' }],
  });

  return (
    <>
      <TopBar user={user} cases={cases} selectedCaseId={null} />
      <main style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Quellenkatalog</h2>
          {user.role === 'ADMIN' ? (
            <form action={syncCatalogAction}>
              <button type="submit" className="btn small">
                Seed-Katalog erneut synchronisieren
              </button>
            </form>
          ) : null}
          <span className="muted" style={{ fontSize: 12 }}>
            {sources.length} Quellen · {sources.filter((s) => s.active).length} aktiv
          </span>
        </div>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'color-mix(in oklab, var(--muted) 8%, transparent)' }}>
                <Th>Name</Th>
                <Th>Kategorie</Th>
                <Th>Modus</Th>
                <Th>Coverage</Th>
                <Th>Filter-Qualität</Th>
                <Th>Terms</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <Td>
                    <div>
                      <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer">
                        <strong>{s.name}</strong>
                      </a>
                      {s.aliases.length > 0 ? (
                        <div className="muted" style={{ fontSize: 11 }}>
                          Aliase: {s.aliases.map((a) => a.name).join(', ')}
                        </div>
                      ) : null}
                    </div>
                  </Td>
                  <Td>{s.category}</Td>
                  <Td>
                    <span className="chip">{s.integrationMode.replace('_', ' ')}</span>
                  </Td>
                  <Td>
                    {s.coverage.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      s.coverage.map((c) => `${c.kind}${c.value ? ':' + c.value : ''}`).join(', ')
                    )}
                  </Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {s.filterMappings.map((m) => (
                        <span key={m.id} className={`chip ${m.quality.toLowerCase()}`} title={m.note ?? ''}>
                          {m.canonicalFilter}
                        </span>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <span className="chip">{s.termsReviewStatus.replace(/_/g, ' ')}</span>
                  </Td>
                  <Td>
                    {s.active ? (
                      <span className="status-contacted">aktiv</span>
                    ) : (
                      <span className="status-rejected">inaktiv</span>
                    )}
                    {s.temporaryOnly ? (
                      <div className="muted" style={{ fontSize: 11 }}>Nur im Notfallmodus</div>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>{children}</td>;
}
