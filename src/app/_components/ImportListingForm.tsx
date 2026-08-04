import { importListingAction } from '../actions';

interface Props {
  sources: Array<{ id: string; name: string; integrationMode: string }>;
}

export function ImportListingForm({ sources }: Props) {
  return (
    <form action={importListingAction} style={{ display: 'grid', gap: 6 }}>
      <div>
        <label>Quelle</label>
        <select className="input" name="sourceId" required>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.integrationMode}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label>Original-URL</label>
        <input className="input" name="rawUrl" type="url" required placeholder="https://…" />
      </div>
      <div>
        <label>Titel</label>
        <input className="input" name="title" required maxLength={512} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <label>PLZ</label>
          <input className="input" name="locationPostal" maxLength={16} />
        </div>
        <div>
          <label>Ort</label>
          <input className="input" name="locationCity" maxLength={128} />
        </div>
      </div>
      <div>
        <label>Standort (frei)</label>
        <input className="input" name="locationRaw" />
      </div>
      <div>
        <label>Beschreibung (Text der Anzeige)</label>
        <textarea className="textarea" name="descriptionRaw" style={{ minHeight: 100 }} required />
      </div>
      <button type="submit" className="btn primary small">
        Anzeige importieren
      </button>
      <span className="muted" style={{ fontSize: 11 }}>
        Der deterministische Parser extrahiert Möblierung, Kosten, Zimmer, Warnungen und legt einen Ranking-Eintrag an.
      </span>
    </form>
  );
}
