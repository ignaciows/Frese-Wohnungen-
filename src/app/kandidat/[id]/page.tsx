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

  // What is waiting on this candidate today. The reminders were being created
  // and then only ever shown on a separate Aufgaben page, so the person's own
  // screen said nothing about the three enquiries going unanswered on it.
  const { listDueTasks } = await import('@/server/followUps');
  const dueTasks = await listDueTasks({ candidateCaseId: id });
  // An answer outranks everything else on this screen: it is the only state
  // where somebody is waiting on *us*.
  const unreadReplies = await prisma.contactMessage.count({
    where: {
      direction: 'INCOMING',
      readAt: null,
      contactAttempt: { candidateCaseId: id },
    },
  });

  return (
    <div className="stack-lg">
      {/* One line saying what to do now, before any number. Everything under
          it is context; this is the instruction. */}
      <TodayBanner
        candidateId={id}
        unreadReplies={unreadReplies}
        dueTasks={dueTasks.length}
        toContact={toContact}
        awaiting={awaiting}
      />

      <div className="grid-4">
        <Stat value={good} label="Passende Anzeigen" />
        <Stat value={contacted} label={contacted === 1 ? 'Anfrage gesendet' : 'Anfragen gesendet'} />
        <Stat value={awaiting} label="Wartet auf Antwort" />
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

/**
 * The one instruction, above everything else.
 *
 * The overview opened with four numbers and a five-step checklist, and a
 * colleague still had to work out what to actually do next. There is almost
 * always exactly one answer — chase the enquiries that have gone quiet, or send
 * some more — so it is said in one sentence with one button, and the numbers
 * become the context underneath rather than the message.
 */
function TodayBanner({
  candidateId,
  unreadReplies,
  dueTasks,
  toContact,
  awaiting,
}: {
  candidateId: string;
  unreadReplies: number;
  dueTasks: number;
  toContact: number;
  awaiting: number;
}) {
  // A landlord who has written back is the only person waiting on us, and a
  // reply that sits unread for a day is how a flat gets let to somebody else.
  if (unreadReplies > 0) {
    return (
      <Link href={`/kandidat/${candidateId}/kontakte`} className="today reply">
        <span className="today-num">{unreadReplies}</span>
        <span className="today-text">
          <strong>{unreadReplies === 1 ? 'Neue Antwort' : 'Neue Antworten'}</strong>
          <span>Ein Vermieter hat geschrieben — bitte zuerst hier weitermachen.</span>
        </span>
        <span className="btn primary nowrap">Lesen</span>
      </Link>
    );
  }

  // Chasing beats sending: a landlord who has read the enquiry and not answered
  // is a closer prospect than one who has never heard of us.
  if (dueTasks > 0) {
    return (
      <Link href={`/kandidat/${candidateId}/kontakte`} className="today warn">
        <span className="today-num">{dueTasks}</span>
        <span className="today-text">
          <strong>{dueTasks === 1 ? 'Anfrage nachfassen' : 'Anfragen nachfassen'}</strong>
          <span>Seit drei Tagen keine Antwort — jetzt prüfen.</span>
        </span>
        <span className="btn primary nowrap">Prüfen</span>
      </Link>
    );
  }

  if (toContact > 0) {
    return (
      <Link href={`/kandidat/${candidateId}/ergebnisse`} className="today go">
        <span className="today-num">{toContact}</span>
        <span className="today-text">
          <strong>{toContact === 1 ? 'Anzeige zu kontaktieren' : 'Anzeigen zu kontaktieren'}</strong>
          <span>Fünf bis zehn Anfragen pro Besuch reichen.</span>
        </span>
        <span className="btn primary nowrap">Loslegen</span>
      </Link>
    );
  }

  if (awaiting > 0) {
    return (
      <div className="today calm">
        <span className="today-num">✓</span>
        <span className="today-text">
          <strong>Alles rausgeschickt</strong>
          <span>
            {awaiting} {awaiting === 1 ? 'Anfrage wartet' : 'Anfragen warten'} auf Antwort. Wir erinnern
            automatisch.
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="today calm">
      <span className="today-num">○</span>
      <span className="today-text">
        <strong>Noch nichts zu tun</strong>
        <span>Sobald die Suche neue Anzeigen findet, stehen sie hier.</span>
      </span>
    </div>
  );
}
