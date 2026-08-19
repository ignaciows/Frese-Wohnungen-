import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { Stat } from '@/app/_components/Shell';
import { PriorityCard } from '@/app/_components/PriorityCard';
import { Timeline } from '@/app/_components/Timeline';
import { SentAnfragen } from '@/app/_components/SentAnfragen';
import { loadCandidatePriority } from '@/server/priority';
import { loadCandidateTimeline } from '@/server/timeline';
import { featureOn } from '@/server/settings';

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
        select: { contactedAt: true, outcome: true },
      },
    },
  });
  if (!candidate) notFound();

  // Abschaltbar: ohne den Baustein „Zeitleiste" wird sie gar nicht erst
  // geladen — ein ausgeschalteter Baustein soll auch nichts rechnen. Die
  // Abfrage steht bewusst vor dem Promise.all: ein `await` mitten im Array
  // lässt die anderen Versprechen unbeaufsichtigt laufen.
  const showTimeline = await featureOn('timeline');
  const [priority, timeline] = await Promise.all([
    loadCandidatePriority(id),
    showTimeline ? loadCandidateTimeline(id) : null,
  ]);
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

      {/* The case as a line: contract, today, arrival, and every flat with the
          day it was written to and the day it is actually free. This is the
          screen's answer to "wie viel Zeit bleibt noch" — the numbers under it
          are the detail. */}
      {timeline ? <Timeline view={timeline} candidateId={id} /> : null}

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
          {/* What is out there and how old it is. The list of the last six
              contacts that used to sit here said the same thing as the timeline
              above, only without the dates that make it mean something. */}
          <SentAnfragen attempts={candidate.contactAttempts} candidateId={id} />
          {priority ? <PriorityCard p={priority} /> : null}
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
