import { prisma } from '@/lib/prisma';
import { loadTouchpoints, rebuildWeeklySummaries, weekLabel } from '@/server/activity';
import { Empty, Stat } from '@/app/_components/Shell';
import { formatDateTime } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const KIND: Record<string, { label: string; tone: string; icon: string }> = {
  ANFRAGE: { label: 'Anfrage', tone: 'info', icon: '→' },
  REPLY_POSITIVE: { label: 'Positiv', tone: 'success', icon: '✓' },
  REPLY_NEGATIVE: { label: 'Absage', tone: 'danger', icon: '×' },
  REPLY_INFO: { label: 'Unterlagen', tone: 'warning', icon: '!' },
  MESSAGE_OUT: { label: 'Nachricht', tone: '', icon: '→' },
  MESSAGE_IN: { label: 'Antwort', tone: '', icon: '←' },
  APPOINTMENT: { label: 'Termin', tone: 'info', icon: '🗓' },
  LISTING_IMPORTED: { label: 'Import', tone: '', icon: '↓' },
  SOURCE_CHECKED: { label: 'Quelle', tone: '', icon: '○' },
};

export default async function VerlaufPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Refreshed on view so the numbers are never stale; it is a cheap recompute
  // over one candidate's own records.
  await rebuildWeeklySummaries(id);

  const [weeks, touchpoints] = await Promise.all([
    prisma.weeklySummary.findMany({
      where: { candidateCaseId: id },
      orderBy: { weekStart: 'desc' },
      take: 12,
    }),
    loadTouchpoints(id, 120),
  ]);

  const totals = weeks.reduce(
    (acc, w) => ({
      anfragen: acc.anfragen + w.anfragenSent,
      positive: acc.positive + w.positiveReplies,
      imported: acc.imported + w.listingsImported,
      appointments: acc.appointments + w.appointmentsHeld,
    }),
    { anfragen: 0, positive: 0, imported: 0, appointments: 0 },
  );

  return (
    <div className="stack-lg">
      <div className="grid-4">
        <Stat value={totals.anfragen} label="Anfragen (12 Wochen)" />
        <Stat value={totals.positive} label="Positive Rückmeldungen" accent />
        <Stat value={totals.imported} label="Anzeigen importiert" />
        <Stat value={totals.appointments} label="Termine gehalten" />
      </div>

      <section className="stack">
        <h2>Wochenübersicht</h2>
        {weeks.length === 0 ? (
          <div className="card">
            <Empty icon="▦" title="Noch keine Aktivität">
              Sobald Anzeigen importiert oder Anfragen gesendet werden, entsteht hier automatisch eine
              Wochenstatistik.
            </Empty>
          </div>
        ) : (
          <div className="card table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Woche</th>
                  <th>Anfragen</th>
                  <th>Positiv</th>
                  <th>Absagen</th>
                  <th>Offen</th>
                  <th>Importiert</th>
                  <th>Quellen</th>
                  <th>Termine</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.id}>
                    <td className="nowrap">
                      <strong>{weekLabel(w.weekStart)}</strong>
                    </td>
                    <td>{w.anfragenSent}</td>
                    <td>{w.positiveReplies > 0 ? <strong>{w.positiveReplies}</strong> : 0}</td>
                    <td>{w.negativeReplies}</td>
                    <td>{w.awaitingReplies}</td>
                    <td>{w.listingsImported}</td>
                    <td>{w.sourcesChecked}</td>
                    <td>
                      {w.appointmentsHeld}
                      {w.appointmentsAhead > 0 ? (
                        <span className="small subtle"> (+{w.appointmentsAhead} geplant)</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small subtle">
          Wird automatisch aus den erfassten Vorgängen berechnet — nichts muss von Hand gepflegt werden.
        </p>
      </section>

      <section className="stack">
        <h2>Touchpoints</h2>
        {touchpoints.length === 0 ? (
          <div className="card">
            <Empty icon="·" title="Noch keine Vorgänge" />
          </div>
        ) : (
          <div className="card">
            {touchpoints.map((t, i) => {
              const k = KIND[t.kind] ?? { label: t.kind, tone: '', icon: '·' };
              return (
                <div key={i} className="listing" style={{ gridTemplateColumns: '110px 1fr auto' }}>
                  <span className={`badge ${k.tone}`} style={{ alignSelf: 'start' }}>
                    {k.icon} {k.label}
                  </span>
                  <span className="listing-main">
                    <span className="listing-title" style={{ fontSize: 13.5 }}>
                      {t.title}
                    </span>
                    {t.detail ? <span className="small muted">{t.detail}</span> : null}
                  </span>
                  <span className="listing-side">
                    <span className="small subtle nowrap">{formatDateTime(t.at)}</span>
                    {t.who ? <span className="small subtle">{t.who}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
