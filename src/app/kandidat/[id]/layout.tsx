import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { inboxCounts } from '@/server/followUps';
import { currentUser } from '@/lib/auth';
import { AppBar, Crumbs } from '@/app/_components/Shell';
import { getFeatureSettings } from '@/server/settings';
import { isFeatureOn } from '@/domain/features';
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
  const pending = await inboxCounts();
  const { id } = await params;
  const features = await getFeatureSettings();

  const candidate = await prisma.candidateCase.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      displayName: true,
      status: true,
      searchProfile: {
        select: {
          employer: true,
          workplaceCity: true,
          workplaceAddress: true,
          maxWarmmieteCents: true,
        },
      },
      _count: { select: { contactAttempts: true } },
    },
  });
  if (!candidate) notFound();

  const [toContact, upcomingAppointments] = await Promise.all([
    prisma.candidateListingMatch.count({
      where: { candidateCaseId: id, status: { in: ['NEW', 'FAVORITE'] } },
    }),
    // Only what is still ahead: a badge counting last month's viewings is a
    // number nobody can act on.
    prisma.appointment.count({
      where: { candidateCaseId: id, status: 'SCHEDULED', scheduledAt: { gte: new Date() } },
    }),
  ]);

  return (
    <>
      <AppBar user={user} active="kandidaten" pending={pending.dueTasks + pending.unreadReplies} />
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
            {/* Arbeitgeber, dann Arbeitsort, dann Budget — in der Reihenfolge,
                in der jemand den Fall im Kopf sortiert: für wen arbeitet sie,
                wo, und wie viel darf es kosten. Die Adresse ist zugleich der
                Punkt, um den herum gesucht wird. */}
            <div className="small muted">
              {[
                candidate.searchProfile?.employer,
                candidate.searchProfile?.workplaceCity || candidate.searchProfile?.workplaceAddress,
                candidate.searchProfile
                  ? `max. ${Math.round(candidate.searchProfile.maxWarmmieteCents / 100)} € warm`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </div>
          </div>
        </div>
        <CandidateNav
          candidateId={candidate.id}
          counts={{
            ergebnisse: toContact,
            kontakte: candidate._count.contactAttempts,
            termine: upcomingAppointments,
          }}
          // Ausgeschaltete Bausteine verlieren ihren Reiter. Die Daten
          // dahinter bleiben — wer den Baustein wieder anschaltet, findet
          // seine Termine unverändert vor.
          hidden={isFeatureOn(features, 'appointments') ? [] : ['termine']}
        />
      </div>
      <main className="container-wide" style={{ paddingTop: 22, paddingBottom: 72 }}>
        {children}
      </main>
    </>
  );
}
