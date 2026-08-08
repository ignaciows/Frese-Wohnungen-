import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/auth';
import { AppBar, Crumbs } from '@/app/_components/Shell';
import { CandidateNav } from './_nav';

export const dynamic = 'force-dynamic';

export default async function CandidateLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { id } = await params;

  const candidate = await prisma.candidateCase.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      displayName: true,
      status: true,
      searchProfile: { select: { workplaceCity: true, workplaceAddress: true, maxWarmmieteCents: true } },
      _count: { select: { contactAttempts: true } },
    },
  });
  if (!candidate) notFound();

  const [toContact, openSourceChecks] = await Promise.all([
    prisma.candidateListingMatch.count({
      where: { candidateCaseId: id, status: { in: ['NEW', 'FAVORITE'] } },
    }),
    prisma.sourceCheck.count({
      where: { searchRun: { candidateCaseId: id }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    }),
  ]);

  return (
    <>
      <AppBar user={user} active="kandidaten" />
      <div className="container-wide" style={{ paddingTop: 20 }}>
        <Crumbs
          items={[
            { label: 'Kandidaten', href: '/' },
            { label: candidate.displayName },
          ]}
        />
        <div className="row-between" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
          <div className="stack-sm">
            <div className="row-wrap">
              <h1>{candidate.displayName}</h1>
              <span className="badge">{candidate.reference}</span>
              {candidate.status === 'ARCHIVED' ? <span className="badge">Archiviert</span> : null}
            </div>
            <div className="small muted">
              {candidate.searchProfile?.workplaceCity || candidate.searchProfile?.workplaceAddress || '—'}
              {candidate.searchProfile
                ? ` · max. ${Math.round(candidate.searchProfile.maxWarmmieteCents / 100)} € warm`
                : ''}
            </div>
          </div>
        </div>
        <CandidateNav
          candidateId={candidate.id}
          counts={{ ergebnisse: toContact, quellen: openSourceChecks, kontakte: candidate._count.contactAttempts }}
        />
      </div>
      <main className="container-wide" style={{ paddingTop: 22, paddingBottom: 72 }}>
        {children}
      </main>
    </>
  );
}
