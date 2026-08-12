import Link from 'next/link';
import { formatEuroCents } from '@/lib/money';
import type { TimelineTrack, TimelineView } from '@/domain/timeline';

/**
 * The case, drawn as one line from left to right.
 *
 * Read in this order: the sentence at the top says how much time is left, the
 * axis under it says where today sits between the contract and the arrival, and
 * each row below is one flat with the day we wrote to it, the day it answered
 * and the day it is free. A flat whose bar ends to the right of the arrival
 * flag is one that comes too late, and that is meant to be visible without
 * reading a single number.
 */
export function Timeline({
  view,
  candidateId,
}: {
  view: TimelineView;
  candidateId: string;
}) {
  const today = view.markers.find((m) => m.key === 'today')!;
  const arrival = view.markers.find((m) => m.key === 'arrival');

  return (
    <section className={`tl tl-${view.stage.toLowerCase()}`}>
      <header className="tl-head">
        <span className="tl-icon" aria-hidden>
          {stageIcon(view.stage)}
        </span>
        <div className="tl-head-text">
          <strong>{view.headline}</strong>
          <span className="small muted">
            {view.markers
              .filter((m) => m.key !== 'today')
              .map((m) => `${m.label}: ${m.at.toLocaleDateString('de-DE')}`)
              .join(' · ') || 'Keine Termine hinterlegt'}
          </span>
        </div>
      </header>

      <div className="tl-body">
        <div className="tl-axis">
          <div className="tl-axis-label" />
          <div className="tl-rail tl-months">
            {view.months.map((m) => (
              <span key={m.at.toISOString()} className="tl-month" style={{ left: `${m.pct}%` }}>
                {m.label}
              </span>
            ))}
          </div>
        </div>

        <div className="tl-rows">
          {/* Two vertical lines run through every row: today, and the day the
              person lands. Everything to the right of the second one is late. */}
          <div className="tl-guides" aria-hidden>
            <span className="tl-guide today" style={{ left: `${today.pct}%` }} />
            {arrival ? <span className="tl-guide arrival" style={{ left: `${arrival.pct}%` }} /> : null}
          </div>

          <div className="tl-axis tl-flags">
            <div className="tl-axis-label" />
            <div className="tl-rail">
              {view.markers.map((m) => (
                <span key={m.key} className={`tl-flag ${m.key}`} style={{ left: `${m.pct}%` }}>
                  <span className="tl-flag-dot" aria-hidden />
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          {view.tracks.length === 0 ? (
            <p className="tl-empty small muted">
              Noch keine Wohnung auf der Linie. Sobald eine Anfrage rausgeht — oder du eine Anzeige als
              Favorit markierst — erscheint sie hier mit ihrem Datum.
            </p>
          ) : (
            view.tracks.map((t) => (
              <TrackRow key={t.flat.id} track={t} candidateId={candidateId} arrivalPct={arrival?.pct} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function TrackRow({
  track,
  candidateId,
  arrivalPct,
}: {
  track: TimelineTrack;
  candidateId: string;
  arrivalPct?: number;
}) {
  const f = track.flat;
  // A flat that only becomes free after the person has landed is the single
  // most expensive thing on this screen to overlook.
  const late = track.gapDays != null && track.gapDays > 0;

  return (
    <div className={`tl-row stage-${track.stage.toLowerCase()}`}>
      <Link className="tl-axis-label tl-flat" href={`/kandidat/${candidateId}/ergebnisse?listing=${f.id}&tab=alle`}>
        <span className="tl-flat-text">
          <span className="tl-flat-title">{f.title}</span>
          <span className="tl-flat-sub">
            {[f.priceCents != null ? formatEuroCents(f.priceCents) : null, f.city]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {/* The one fact that decides whether this flat is any use: is it free
              before the person lands, or after? Said here rather than on the
              rail, where a long bar would run underneath it. */}
          <span className={`tl-ready ${late ? 'late' : ''}`}>
            {track.readyLabel}
            {track.gapDays != null && track.gapDays !== 0
              ? late
                ? ` · ${track.gapDays} Tage zu spät`
                : ` · ${Math.abs(track.gapDays)} Tage vorher`
              : ''}
          </span>
        </span>
      </Link>

      <div className="tl-rail">
        <span
          className="tl-bar"
          style={{ left: `${track.startPct}%`, width: `${Math.max(1.5, track.endPct - track.startPct)}%` }}
        />
        {track.events.map((e) => (
          <span key={`${e.kind}-${e.at.toISOString()}`} className={`tl-dot ${e.kind}`} style={{ left: `${e.pct}%` }}>
            <span className="tl-dot-mark" aria-hidden>
              {eventIcon(e.kind)}
            </span>
            <span className="tl-dot-tip">{e.label}</span>
          </span>
        ))}
        {late && arrivalPct != null ? (
          <span
            className="tl-gap"
            style={{ left: `${arrivalPct}%`, width: `${Math.max(0, track.endPct - arrivalPct)}%` }}
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

function stageIcon(stage: TimelineView['stage']): string {
  switch (stage) {
    case 'SECURED':
      return '✓';
    case 'PROMISING':
      return '◎';
    case 'WAITING':
      return '⏳';
    case 'NO_DATES':
      return '?';
    default:
      return '→';
  }
}

function eventIcon(kind: TimelineTrack['events'][number]['kind']): string {
  switch (kind) {
    case 'sent':
      return '✉';
    case 'reply':
      return '↩';
    case 'viewing':
      return '◎';
    default:
      return '⌂';
  }
}
