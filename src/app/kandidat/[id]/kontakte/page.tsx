import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { Empty, Stat } from '@/app/_components/Shell';
import { ConversationCard, type ConversationData } from '@/app/_components/ConversationCard';
import { getFollowUpSettings } from '@/server/settings';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'alle', label: 'Alle' },
  { key: 'offen', label: 'Wartet auf Antwort' },
  { key: 'positiv', label: 'Positiv' },
  { key: 'unterlagen', label: 'Unterlagen' },
  { key: 'absage', label: 'Absagen' },
] as const;

export default async function KontaktePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const { id } = await params;
  const { f = 'alle' } = await searchParams;

  const outcomeWhere =
    f === 'offen'
      ? { outcome: 'AWAITING' as const }
      : f === 'positiv'
        ? { outcome: 'POSITIVE' as const }
        : f === 'unterlagen'
          ? { outcome: 'NEEDS_INFO' as const }
          : f === 'absage'
            ? { outcome: 'NEGATIVE' as const }
            : {};

  const [attempts, all] = await Promise.all([
    prisma.contactAttempt.findMany({
      where: { candidateCaseId: id, ...outcomeWhere },
      orderBy: { contactedAt: 'desc' },
      include: {
        listing: { include: { source: { select: { name: true } } } },
        user: { select: { name: true } },
        outcomeBy: { select: { name: true } },
        systemTransfer: { include: { registeredBy: { select: { name: true } } } },
        messages: {
          orderBy: { occurredAt: 'asc' },
          include: { recordedBy: { select: { name: true } } },
        },
      },
    }),
    prisma.contactAttempt.findMany({
      where: { candidateCaseId: id },
      select: { outcome: true, systemTransfer: { select: { registeredAt: true } } },
    }),
  ]);

  const count = (o: string) => all.filter((a) => a.outcome === o).length;
  const registered = all.filter((a) => a.systemTransfer?.registeredAt).length;

  const followUp = await getFollowUpSettings();
  const dayMs = 86_400_000;
  const now = Date.now();

  const conversations: ConversationData[] = attempts.map((a) => {
    const unread = a.messages.filter((m) => m.direction === 'INCOMING' && m.readAt == null).length;
    const answered = a.messages.some((m) => m.direction === 'INCOMING');
    const waitingDays = answered ? null : Math.floor((now - a.contactedAt.getTime()) / dayMs);
    return {
    id: a.id,
    listingTitle: a.listing.title,
    listingUrl: a.listing.rawUrl,
    sourceName: a.listing.source.name,
    location:
      [a.listing.locationPostal, a.listing.locationCity].filter(Boolean).join(' ') ||
      a.listing.locationRaw ||
      '—',
    contactedAt: a.contactedAt.toISOString(),
    contactedByName: a.user.name,
    outcome: a.outcome,
    outcomeAt: a.outcomeAt ? a.outcomeAt.toISOString() : null,
    outcomeByName: a.outcomeBy?.name ?? null,
    outcomeNote: a.outcomeNote,
    messageSnapshot: a.messageSnapshot,
    transfer: a.systemTransfer
      ? {
          id: a.systemTransfer.id,
          objectLabel: a.systemTransfer.objectLabel,
          link: a.systemTransfer.link,
          location: a.systemTransfer.location,
          registeredAt: a.systemTransfer.registeredAt ? a.systemTransfer.registeredAt.toISOString() : null,
          registeredByName: a.systemTransfer.registeredBy?.name ?? null,
        }
      : null,
    messages: a.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      occurredAt: m.occurredAt.toISOString(),
      // No recorder means the mailbox collected this reply on its own.
      recordedByName: m.recordedBy?.name ?? 'Automatisch aus dem Postfach',
    })),
    unread,
    waitingDays,
    dueForCheck: waitingDays != null && waitingDays >= followUp.checkReplyAfterDays,
    };
  });

  // A reply outranks everything, then whatever has gone quiet longest. Sorting
  // purely by date buried the one landlord who answered under nine who did not.
  conversations.sort((a, b) => {
    if ((b.unread > 0 ? 1 : 0) !== (a.unread > 0 ? 1 : 0)) return b.unread - a.unread;
    if (a.dueForCheck !== b.dueForCheck) return a.dueForCheck ? -1 : 1;
    return (b.waitingDays ?? -1) - (a.waitingDays ?? -1);
  });

  if (all.length === 0) {
    return (
      <div className="card">
        <Empty
          icon="✉"
          title="Noch keine Wohnung kontaktiert"
          action={
            <Link href={`/kandidat/${id}/ergebnisse`} className="btn primary">
              Zu den Ergebnissen
            </Link>
          }
        >
          Sobald du eine Anzeige über „Anschreiben kopieren &amp; Anzeige öffnen“ anschreibst und den
          Versand bestätigst, erscheint hier das Gespräch — inklusive Feld für die Rückmeldung.
        </Empty>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="grid-4">
        <Stat value={all.length} label="Kontaktiert" />
        <Stat value={count('POSITIVE')} label="Positive Antworten" accent />
        <Stat value={count('AWAITING')} label="Wartet auf Antwort" />
        <Stat value={`${registered}/${all.length}`} label="Ins Firmen-System übertragen" />
      </div>

      <nav className="tabs" aria-label="Rückmeldung filtern">
        {FILTERS.map((t) => (
          <Link
            key={t.key}
            href={`/kandidat/${id}/kontakte?f=${t.key}`}
            className="tab"
            aria-current={f === t.key ? 'page' : undefined}
          >
            {t.label}
            <span className="tab-count">
              {t.key === 'alle'
                ? all.length
                : t.key === 'offen'
                  ? count('AWAITING')
                  : t.key === 'positiv'
                    ? count('POSITIVE')
                    : t.key === 'unterlagen'
                      ? count('NEEDS_INFO')
                      : count('NEGATIVE')}
            </span>
          </Link>
        ))}
      </nav>

      {conversations.length === 0 ? (
        <div className="card">
          <Empty icon="○" title="Nichts in diesem Filter" />
        </div>
      ) : (
        <div className="stack" style={{ maxWidth: 900 }}>
          {conversations.map((c) => (
            <ConversationCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}
