import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { newSearchRunAction } from '@/app/actions';
import { Callout, Empty } from '@/app/_components/Shell';
import { SourceBoard } from '@/app/_components/SourceBoard';
import type { SourceTaskData } from '@/app/_components/SourceTask';
import { formatDate } from '@/lib/labels';
import { SubmitButton } from '@/app/_components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function QuellenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const run = await prisma.searchRun.findFirst({
    where: { candidateCaseId: id },
    orderBy: { createdAt: 'desc' },
    include: {
      sourceChecks: {
        orderBy: [{ status: 'asc' }, { source: { priority: 'asc' } }],
        include: {
          source: true,
          checkedBy: { select: { name: true } },
        },
      },
    },
  });

  if (!run) {
    return (
      <div className="card">
        <Empty
          icon="▶"
          title="Noch kein Suchlauf gestartet"
          action={
            <form action={newSearchRunAction}>
              <input type="hidden" name="candidateCaseId" value={id} />
              <SubmitButton className="btn primary">
                Suchlauf starten
              </SubmitButton>
            </form>
          }
        >
          Ein Suchlauf erstellt eine Aufgabe pro relevanter Quelle — auch für Portale, die man von Hand
          durchsuchen muss. So geht keine Quelle verloren.
        </Empty>
      </div>
    );
  }

  const tasks: SourceTaskData[] = run.sourceChecks.map((c) => ({
    id: c.id,
    status: c.status,
    importedCount: c.importedCount,
    lastCheckedAt: c.lastCheckedAt ? c.lastCheckedAt.toISOString() : null,
    checkedByName: c.checkedBy?.name ?? null,
    note: c.note,
    source: {
      id: c.source.id,
      name: c.source.name,
      websiteUrl: c.source.websiteUrl,
      route: c.source.route,
      manualRecipe: c.source.manualRecipe,
    },
    // Snapshot taken when the run was planned — deliberately not re-derived.
    recipe: (c.recipeSnapshot as unknown as SourceTaskData['recipe']) ?? { headline: '', lines: [] },
  }));

  const done = tasks.filter(
    (t) => t.status !== 'PENDING' && t.status !== 'IN_PROGRESS',
  ).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const imported = tasks.reduce((n, t) => n + t.importedCount, 0);

  return (
    <div className="stack-lg">
      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div>
            <h2>{run.label}</h2>
            <span className="small muted">
              gestartet am {formatDate(run.createdAt)} · {tasks.length} Quellen · {imported} Anzeigen importiert
            </span>
          </div>
          <div className="row">
            <Link href={`/kandidat/${id}/ergebnisse`} className="btn soft">
              Ergebnisse ansehen →
            </Link>
            <form action={newSearchRunAction}>
              <input type="hidden" name="candidateCaseId" value={id} />
              <SubmitButton className="btn">
                Neuer Suchlauf
              </SubmitButton>
            </form>
          </div>
        </div>
        <div className="progress" aria-label={`${pct}% erledigt`}>
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {done} von {tasks.length} Quellen bearbeitet ({pct} %)
        </div>
      </div>

      <Callout tone="info">
        <strong>Du brauchst keine Portal-Passwörter in dieser App.</strong> Die Quellen öffnen sich in deinem
        normalen Browser, wo du ohnehin angemeldet bist. Die App durchsucht die Portale nicht selbst — sie
        merkt sich, welche du schon geprüft hast, und übersetzt dein Suchprofil in die Filter jedes Portals.
      </Callout>

      <SourceBoard tasks={tasks} />
    </div>
  );
}
