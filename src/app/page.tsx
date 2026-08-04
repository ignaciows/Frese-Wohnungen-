import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { currentUser } from '@/lib/auth';
import { TopBar } from './_components/TopBar';
import { LeftRail } from './_components/LeftRail';
import { ResultsColumn } from './_components/ResultsColumn';
import { DetailPanel } from './_components/DetailPanel';
import { NewCandidateCard } from './_components/NewCandidateCard';

interface PageProps {
  searchParams: Promise<{
    case?: string;
    listing?: string;
    tab?: string;
    error?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const tab = params.tab ?? 'all';

  const cases = await prisma.candidateCase.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, reference: true, displayName: true, status: true },
  });

  if (cases.length === 0) {
    return (
      <>
        <TopBar user={user} cases={[]} selectedCaseId={null} />
        <main style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
          <h2>Willkommen bei Frese Wohnung</h2>
          <p className="muted" style={{ marginBottom: 24 }}>
            Noch kein Kandidat angelegt. Lege den ersten Kandidatenfall an, um einen Suchlauf zu starten.
          </p>
          <NewCandidateCard />
        </main>
      </>
    );
  }

  const selectedId = params.case && cases.find((c) => c.id === params.case) ? params.case : cases[0].id;
  const candidate = await prisma.candidateCase.findUniqueOrThrow({
    where: { id: selectedId },
    include: {
      applicationMessage: true,
      searchProfile: true,
      searchRuns: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          sourceChecks: {
            include: { source: true, checkedBy: true },
            orderBy: [{ status: 'asc' }, { source: { priority: 'asc' } }],
          },
        },
      },
    },
  });

  const sources = await prisma.source.findMany({
    where: { active: true },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, key: true, integrationMode: true },
  });

  const matches = await prisma.candidateListingMatch.findMany({
    where: {
      candidateCaseId: candidate.id,
      ...(tab === 'favorites' ? { status: 'FAVORITE' } : {}),
      ...(tab === 'to-contact' ? { status: { in: ['NEW', 'FAVORITE'] } } : {}),
      ...(tab === 'in-progress' ? { status: 'IN_PROGRESS' } : {}),
      ...(tab === 'contacted' ? { status: 'CONTACTED' } : {}),
      ...(tab === 'rejected' ? { status: { in: ['REJECTED', 'EXPIRED'] } } : {}),
    },
    include: {
      listing: { include: { source: true } },
    },
    orderBy: [{ compatibility: 'asc' }, { score: 'desc' }],
  });

  const selectedListingId =
    params.listing && matches.find((m) => m.listingId === params.listing) ? params.listing : matches[0]?.listingId;

  const detailMatch = selectedListingId
    ? await prisma.candidateListingMatch.findUnique({
        where: {
          candidateCaseId_listingId: { candidateCaseId: candidate.id, listingId: selectedListingId },
        },
        include: {
          listing: {
            include: {
              source: true,
              facts: { orderBy: { key: 'asc' } },
              claims: { where: { releasedAt: null }, include: { user: true }, orderBy: { claimedAt: 'desc' } },
              contactAttempts: {
                include: { user: true, candidateCase: true, systemTransfer: true },
                orderBy: { contactedAt: 'desc' },
              },
              duplicateLinks: {
                include: {
                  group: {
                    include: {
                      members: { include: { listing: { include: { source: true } } } },
                    },
                  },
                },
              },
            },
          },
        },
      })
    : null;

  return (
    <>
      <TopBar user={user} cases={cases} selectedCaseId={candidate.id} />
      {params.error ? (
        <div
          style={{
            background: 'color-mix(in oklab, var(--danger) 12%, transparent)',
            color: 'var(--danger)',
            padding: '6px 16px',
            fontSize: 13,
          }}
        >
          Aktion abgebrochen: {params.error.replace(/_/g, ' ')} —{' '}
          <Link href={`/?case=${candidate.id}`}>schließen</Link>
        </div>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 380px) 1fr minmax(360px, 460px)',
          gap: 12,
          padding: 12,
          alignItems: 'start',
        }}
      >
        <LeftRail
          candidate={candidate}
          searchRun={candidate.searchRuns[0] ?? null}
          allSources={sources}
        />
        <ResultsColumn candidate={candidate} matches={matches} activeTab={tab} selectedListingId={selectedListingId ?? null} />
        <DetailPanel candidate={candidate} match={detailMatch} />
      </div>
    </>
  );
}
