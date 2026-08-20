import Link from 'next/link';

/**
 * Why the list is empty, said with the two facts that decide what to do next.
 *
 * "Nothing found" is not an answer — it leaves open whether the search ran at
 * all, whether it ran somewhere useful, and whether the criteria or the market
 * are at fault. Those need opposite reactions, and guessing wrong wastes a day.
 *
 * So: where we looked and what came back from each place, and then the smallest
 * change that would actually produce flats, measured against the adverts we
 * already hold rather than promised in the abstract.
 */
export interface WhyEmptyProps {
  candidateId: string;
  /** Where the search ran, newest run per source. */
  searched: Array<{ name: string; found: number; note: string | null; at: Date | null }>;
  /** Changes that would unlock flats, best first. */
  suggestions: Array<{ key: string; label: string; gained: number }>;
  /** Adverts held for this candidate that no criterion currently admits. */
  setAside: number;
}

export function WhyEmpty({ candidateId, searched, suggestions, setAside }: WhyEmptyProps) {
  return (
    <div className="why-empty">
      <div className="why-block">
        <h4>Wo gesucht wurde</h4>
        {searched.length === 0 ? (
          <p className="small muted">
            Für diesen Fall lief noch kein Suchlauf.{' '}
            <Link href="/einstellungen">Quellen prüfen</Link>
          </p>
        ) : (
          <ul className="why-list">
            {searched.map((s) => (
              <li key={s.name}>
                <span className={`why-dot ${s.found > 0 ? 'ok' : 'none'}`} aria-hidden />
                <span className="why-name">{s.name}</span>
                <span className="why-count">
                  {s.found > 0 ? `${s.found} gefunden` : 'nichts gefunden'}
                </span>
                {s.note ? <span className="why-note">{s.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {suggestions.length > 0 ? (
        <div className="why-block">
          <h4>Was Treffer bringen würde</h4>
          {/* Each number is counted against the adverts already held, so it is
              a promise the list can keep the moment the change is applied. */}
          <ul className="why-list">
            {suggestions.map((s) => (
              <li key={s.key}>
                <span className="why-gain">+{s.gained}</span>
                <span className="why-name">{s.label}</span>
              </li>
            ))}
          </ul>
          <Link href={`/kandidat/${candidateId}/profil`} className="btn primary">
            Suchprofil anpassen
          </Link>
        </div>
      ) : setAside > 0 ? (
        <div className="why-block">
          <h4>Was Treffer bringen würde</h4>
          <p className="small muted">
            {setAside} Anzeigen liegen daneben, aber keine einzelne Lockerung holt sie herein — sie sind
            zu weit weg oder vom falschen Typ. Hier fehlt Nachschub, nicht ein weiterer Filter.
          </p>
        </div>
      ) : null}
    </div>
  );
}
