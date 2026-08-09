import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { Stat, Callout } from '@/app/_components/Shell';
import { PriorityCard } from '@/app/_components/PriorityCard';
import { loadCandidatePriority } from '@/server/priority';
import { formatDate, RESPONSE_OUTCOME } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function CandidateOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const candidate = await prisma.candidateCase.findUnique({
    where: { id },
    include: {
      applicationMessage: true,
      searchProfile: true,
      searchRuns: {
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { sourceChecks: true } } },
      },
      matches: { select: { status: true, compatibility: true } },
      contactAttempts: {
        orderBy: { contactedAt: 'desc' },
        include: { listing: { select: { title: true } } },
      },
    },
  });
  if (!candidate) notFound();

  const priority = await loadCandidatePriority(id);
  const hasMessage = (candidate.applicationMessage?.body ?? '').trim().length > 0;
  const runs = candidate.searchRuns;
  const checksDone = runs.length
    ? await prisma.sourceCheck.count({
        where: { searchRunId: runs[0].id, status: { notIn: ['PENDING', 'IN_PROGRESS'] } },
      })
    : 0;
  const checksTotal = runs.length ? runs[0]._count.sourceChecks : 0;

  const good = candidate.matches.filter(
    (m) => m.compatibility === 'COMPATIBLE' || m.compatibility === 'NEAR_MATCH',
  ).length;
  const toContact = candidate.matches.filter((m) => m.status === 'NEW' || m.status === 'FAVORITE').length;
  const contacted = candidate.contactAttempts.length;
  const positive = candidate.contactAttempts.filter((a) => a.outcome === 'POSITIVE').length;
  const awaiting = candidate.contactAttempts.filter((a) => a.outcome === 'AWAITING').length;

  const steps = [
    {
      n: 1,
      title: 'Anschreiben einfügen',
      desc: hasMessage
        ? `Gespeichert · ${candidate.applicationMessage!.body.trim().length} Zeichen`
        : 'Den fertigen Text hier einfügen — er wird bei jedem Kontakt mitgespeichert.',
      href: `/kandidat/${id}/anschreiben`,
      done: hasMessage,
      cta: hasMessage ? 'Bearbeiten' : 'Einfügen',
    },
    {
      n: 2,
      title: 'Suchprofil prüfen',
      desc: candidate.searchProfile
        ? `${candidate.searchProfile.workplaceCity || candidate.searchProfile.workplaceAddress} · max. ${Math.round(
            candidate.searchProfile.maxWarmmieteCents / 100,
          )} € warm · ab ${candidate.searchProfile.minRooms} Zimmer`
        : 'Arbeitsort, Budget und Zimmer festlegen.',
      href: `/kandidat/${id}/profil`,
      done: Boolean(candidate.searchProfile),
      cta: 'Anpassen',
    },
    {
      n: 3,
      title: 'Quellen durchgehen',
      desc:
        checksTotal > 0
          ? `${checksDone} von ${checksTotal} Quellen erledigt`
          : 'Suchlauf starten — die App plant eine Aufgabe pro relevanter Quelle.',
      href: `/kandidat/${id}/quellen`,
      done: checksTotal > 0 && checksDone === checksTotal,
      cta: checksTotal > 0 ? 'Weitermachen' : 'Suchlauf starten',
    },
    {
      n: 4,
      title: 'Ergebnisse bewerten & kontaktieren',
      desc:
        candidate.matches.length > 0
          ? `${good} passende Anzeigen · ${toContact} noch zu kontaktieren`
          : 'Noch keine Anzeigen importiert.',
      href: `/kandidat/${id}/ergebnisse`,
      done: contacted > 0,
      cta: 'Öffnen',
    },
    {
      n: 5,
      title: 'Antworten festhalten',
      desc:
        contacted > 0
          ? `${contacted} kontaktiert · ${positive} positiv · ${awaiting} offen`
          : 'Sobald du kontaktierst, erscheinen die Gespräche hier.',
      href: `/kandidat/${id}/kontakte`,
      done: contacted > 0 && awaiting === 0,
      cta: 'Öffnen',
    },
  ];

  const activeIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="stack-lg">
      <div className="grid-4">
        <Stat value={runs.length} label="Suchläufe" />
        <Stat value={good} label="Passende Anzeigen" />
        <Stat value={contacted} label="Kontaktiert" />
        <Stat value={positive} label="Positive Antworten" accent />
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="stack">
          <h2>Nächste Schritte</h2>
          <div className="steps">
            {steps.map((s, i) => (
              <Link
                key={s.n}
                href={s.href}
                className={`step ${s.done ? 'done' : ''} ${i === activeIndex ? 'active' : ''}`}
              >
                <span className="step-num">{s.done ? '✓' : s.n}</span>
                <span className="step-main">
                  <span className="step-title">{s.title}</span>
                  <span className="step-desc">{s.desc}</span>
                </span>
                <span className="btn sm soft nowrap">{s.cta}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="stack">
          {priority ? <PriorityCard p={priority} /> : null}

          <h2>Letzte Kontakte</h2>
          {candidate.contactAttempts.length === 0 ? (
            <div className="card card-pad">
              <p className="muted small">
                Noch keine Wohnung kontaktiert. Sobald du über „Öffnen &amp; Kontaktieren“ eine Anzeige
                anschreibst, siehst du hier den Verlauf.
              </p>
            </div>
          ) : (
            <div className="card">
              {candidate.contactAttempts.slice(0, 6).map((a) => {
                const o = RESPONSE_OUTCOME[a.outcome];
                return (
                  <Link
                    key={a.id}
                    href={`/kandidat/${id}/kontakte#kontakt-${a.id}`}
                    className="listing"
                    style={{ gridTemplateColumns: '1fr auto' }}
                  >
                    <span className="listing-main">
                      <span className="listing-title">{a.listing.title}</span>
                      <span className="small muted">kontaktiert {formatDate(a.contactedAt)}</span>
                    </span>
                    <span className={`badge ${o.tone}`}>
                      {o.icon} {o.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {awaiting > 0 ? (
            <Callout tone="info">
              {awaiting} {awaiting === 1 ? 'Anfrage wartet' : 'Anfragen warten'} noch auf eine Antwort. Trage
              Rückmeldungen unter <Link href={`/kandidat/${id}/kontakte`}>Kontakte</Link> ein, damit das Team
              den Stand sieht.
            </Callout>
          ) : null}
        </section>
      </div>
    </div>
  );
}
