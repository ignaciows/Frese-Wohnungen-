import { PRIORITY_TIER, difficultyLabel } from '@/lib/labels';
import type { CandidatePriorityView } from '@/server/priority';

/**
 * Shows *why* a candidate sits where they sit in the queue. Every number is
 * traceable: seeded estimate vs. our own measurements is stated explicitly.
 */
export function PriorityCard({ p }: { p: CandidatePriorityView }) {
  const tier = PRIORITY_TIER[p.tier];
  const pct = p.targetContacts ? Math.min(100, Math.round((p.contactsSent / p.targetContacts) * 100)) : 0;

  const parts = [
    { label: 'Einzugstermin', value: p.components.deadline, weight: 35 },
    { label: 'Wartezeit', value: p.components.waiting, weight: 20 },
    { label: 'Marktschwierigkeit', value: p.components.market, weight: 25 },
    { label: 'Offene Anfragen', value: p.components.gap, weight: 20 },
  ];

  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <h2>Priorität</h2>
          <span className={`badge ${tier.tone}`}>
            {tier.icon} {tier.label}
          </span>
        </div>
        <span className="badge brand">{Math.round(p.score)} / 100</span>
      </div>

      <div className="card-body stack">
        <div>
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span className="small muted">Empfohlene Anfragen für diesen Markt</span>
            <span className="small">
              <strong>{p.contactsSent}</strong> / {p.targetContacts}
            </span>
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="field-hint">
            {p.remainingContacts > 0
              ? `Noch ${p.remainingContacts} Anfragen empfohlen, um auf drei aussichtsreiche Rückmeldungen zu kommen.`
              : 'Anfrage-Soll erreicht — jetzt auf Rückmeldungen konzentrieren.'}
          </p>
        </div>

        <hr className="divider" />

        <div className="stack-sm">
          <h4>Wie sich die Zahl zusammensetzt</h4>
          {parts.map((part) => (
            <div key={part.label} className="row" style={{ gap: 10 }}>
              <span className="small muted" style={{ width: 150, flexShrink: 0 }}>
                {part.label}
              </span>
              <span className="progress grow" style={{ height: 5 }}>
                <span
                  className="progress-bar"
                  style={{ width: `${Math.round(part.value)}%`, display: 'block', height: '100%' }}
                />
              </span>
              <span className="small subtle nowrap" style={{ width: 78, textAlign: 'right' }}>
                {Math.round(part.value)} · {part.weight} %
              </span>
            </div>
          ))}
        </div>

        {p.reasons.length > 0 ? (
          <div className="stack-sm">
            {p.reasons.map((r, i) => (
              <div key={i} className="reason neutral">
                <span className="mark">·</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        ) : null}

        <hr className="divider" />

        <div className="stack-sm">
          <h4>
            Markt {p.regionLabel} — {difficultyLabel(p.market.difficulty)} (
            {Math.round(p.market.difficulty)}/100)
          </h4>
          {p.market.reasons.map((r, i) => (
            <div key={i} className="small muted">
              {r}
            </div>
          ))}
          <div className="small subtle">
            Erwartete Erfolgsquote: {(p.market.expectedPositiveRate * 100).toFixed(0)} % pro Anfrage
            {p.market.listingsPerRun != null
              ? ` · ${p.market.listingsPerRun.toFixed(1)} passende Anzeigen pro Suchlauf`
              : ''}
            {p.market.confidence > 0
              ? ` · zu ${Math.round(p.market.confidence * 100)} % aus eigenen Daten`
              : ' · noch keine eigenen Daten'}
          </div>
        </div>
      </div>
    </div>
  );
}
