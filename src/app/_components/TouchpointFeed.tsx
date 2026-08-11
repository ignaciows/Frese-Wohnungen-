import type { Touchpoint } from '@/server/touchpoints';

/**
 * What has happened, in the order it happened.
 *
 * Grouped by day, because that is how anybody recalls it ("das war doch
 * Dienstag"), and every row carries the three things that were previously
 * spread over three screens: which flat, at what time, and what came of it.
 * The link goes straight to the advert — the question after "wer hat
 * geantwortet?" is always "welche Wohnung war das noch?".
 */
export function TouchpointFeed({ points }: { points: Touchpoint[] }) {
  if (points.length === 0) {
    return (
      <p className="muted">
        Noch keine Kontakte. Was du über „Anschreiben kopieren &amp; Anzeige öffnen“ verschickst,
        erscheint hier automatisch — mit Uhrzeit, Link und der Antwort, sobald eine kommt.
      </p>
    );
  }

  const days = groupByDay(points);

  return (
    <div className="tp">
      {days.map(([label, items]) => (
        <section key={label} className="tp-day">
          <h3 className="tp-daylabel">{label}</h3>
          <div className="tp-list">
            {items.map((p) => (
              <article key={p.id} className={`tp-item tone-${p.tone}`}>
                <span className="tp-mark" aria-hidden>
                  {icon(p.kind)}
                </span>
                <div className="tp-body">
                  <div className="tp-line">
                    <strong className="tp-title">{p.title}</strong>
                    {p.unread ? <span className="tp-new">neu</span> : null}
                    <span className="tp-time">{time(p.at)}</span>
                  </div>
                  <a
                    className="tp-listing"
                    href={p.listing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {p.listing.title} ↗
                  </a>
                  <div className="tp-meta">
                    {[
                      p.listing.sourceName,
                      p.listing.location,
                      p.actor,
                      // Only what somebody wrote earns a box of its own. "Über
                      // das Formular des Portals" in a quoted panel looks like
                      // a landlord said it.
                      quoted(p) ? null : p.summary,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {quoted(p) ? <p className="tp-summary">{p.summary}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** True when the summary is something a person wrote, not a fact about delivery. */
function quoted(p: Touchpoint): boolean {
  return Boolean(p.summary) && (p.kind === 'reply' || p.kind === 'outcome');
}

function icon(kind: Touchpoint['kind']): string {
  switch (kind) {
    case 'sent':
      return '✉';
    case 'reply':
      return '↩';
    case 'outcome':
      return '●';
    case 'appointment':
      return '◎';
    default:
      return '⇄';
  }
}

function groupByDay(points: Touchpoint[]): Array<[string, Touchpoint[]]> {
  const out = new Map<string, Touchpoint[]>();
  for (const p of points) {
    const label = dayLabel(p.at);
    const bucket = out.get(label);
    if (bucket) bucket.push(p);
    else out.set(label, [p]);
  }
  return [...out.entries()];
}

function dayLabel(d: Date): string {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  if (diff === -1) return 'Morgen';
  if (diff < 0) return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  if (diff < 7) return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function time(d: Date): string {
  return `${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
}
