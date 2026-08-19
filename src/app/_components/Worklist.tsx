import Link from 'next/link';
import type { WorkItem, Worklist as WorklistData } from '@/domain/worklist';
import { describeWorklist } from '@/domain/worklist';

/**
 * Die Tagesliste: womit fange ich heute an.
 *
 * Drei Blöcke in genau einer Reihenfolge — anrufen, anschreiben, und die
 * Fälle, für die gerade nichts da ist. Die Reihenfolge selbst steht in
 * `domain/worklist`; hier wird sie nur gezeichnet.
 *
 * Der Anruf-Block trägt dieselbe grüne Behandlung wie eine Anzeigenzeile mit
 * Nummer. Das ist Absicht: es ist derselbe Befund an einer anderen Stelle, und
 * zwei Farben für dieselbe Sache müsste sich jemand merken.
 */
export function Worklist({ list }: { list: WorklistData }) {
  const summary = describeWorklist(list);
  const nothingAtAll =
    list.call.length === 0 && list.write.length === 0 && list.idle.length === 0;
  if (nothingAtAll) return null;

  return (
    <section className="card worklist" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h2>Heute dran</h2>
        {summary ? <span className="sub">{summary}</span> : null}
      </div>
      <div className="card-body stack">
        {list.call.length > 0 ? (
          <div className="stack-sm">
            <h3 className="worklist-head call">
              <span aria-hidden>☎</span> Zuerst anrufen
            </h3>
            {/* Warum das oben steht und nicht nach Punktestand einsortiert:
                ein Anruf wird in zehn Minuten beantwortet, eine Anfrage am
                Donnerstag oder nie. */}
            <p className="small muted" style={{ margin: 0 }}>
              Diese Anzeigen nennen selbst eine Nummer. Das ist der einzige Weg zu einer Antwort am
              selben Tag — und er ist morgen weg.
            </p>
            <div className="worklist-rows">
              {list.call.map((item, i) => (
                <Row key={item.candidateCaseId} item={item} rank={i + 1} />
              ))}
            </div>
          </div>
        ) : null}

        {list.write.length > 0 ? (
          <div className="stack-sm">
            <h3 className="worklist-head">Dann anschreiben</h3>
            <div className="worklist-rows">
              {list.write.map((item, i) => (
                <Row key={item.candidateCaseId} item={item} rank={list.call.length + i + 1} />
              ))}
            </div>
          </div>
        ) : null}

        {list.idle.length > 0 ? (
          <details className="worklist-idle">
            <summary className="small muted">
              {list.idle.length === 1
                ? '1 Fall ohne offene Wohnung'
                : `${list.idle.length} Fälle ohne offene Wohnung`}
            </summary>
            <div className="worklist-rows" style={{ marginTop: 8 }}>
              {list.idle.map((item) => (
                <Row key={item.candidateCaseId} item={item} rank={null} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function Row({ item, rank }: { item: WorkItem; rank: number | null }) {
  // Die Ergebnisseite und nicht die Fallübersicht: von hier aus wird
  // gearbeitet, und der Zwischenklick über die Übersicht bringt nichts.
  const href = `/kandidat/${item.candidateCaseId}/ergebnisse${
    item.kind === 'CALL' ? '?tab=zu-kontaktieren' : ''
  }`;

  return (
    <Link href={href} className={`worklist-row ${item.kind === 'CALL' ? 'has-phone' : ''}`}>
      <span className="worklist-rank">{rank ?? '·'}</span>
      <span className="worklist-main">
        <span className="worklist-name">
          {item.displayName}
          {item.employer ? <span className="worklist-employer">{item.employer}</span> : null}
        </span>
        <span className="worklist-action">{item.action}</span>
      </span>
      <span className="worklist-side">
        {item.why ? <span className="small muted">{item.why}</span> : null}
        {item.tier === 'CRITICAL' ? <span className="badge danger">dringend</span> : null}
      </span>
    </Link>
  );
}
