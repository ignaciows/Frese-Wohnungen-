import { requireUser } from '@/lib/auth';
import { TopBar } from '../../_components/TopBar';
import { NewCandidateCard } from '../../_components/NewCandidateCard';
import { prisma } from '@/lib/prisma';

export default async function NewCandidatePage() {
  const user = await requireUser();
  const cases = await prisma.candidateCase.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, reference: true, displayName: true, status: true },
  });
  return (
    <>
      <TopBar user={user} cases={cases} selectedCaseId={null} />
      <main style={{ maxWidth: 720, margin: '32px auto', padding: 24 }}>
        <h2>Neuer Kandidat</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Nur pseudonyme Referenz + Wohnungssuche-relevante Angaben. Keine Ausweise, Verträge oder medizinische Daten.
        </p>
        <NewCandidateCard />
      </main>
    </>
  );
}
