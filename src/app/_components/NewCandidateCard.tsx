import { createCandidateAction } from '../actions';

export function NewCandidateCard() {
  return (
    <form action={createCandidateAction} className="card" style={{ padding: 20, display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        <div>
          <label>Interne Referenz</label>
          <input className="input" name="reference" required maxLength={64} placeholder="CAND-2026-014" />
        </div>
        <div>
          <label>Anzeigename</label>
          <input className="input" name="displayName" required maxLength={128} placeholder="Pflegekraft Bad Rappenau" />
        </div>
      </div>
      <div>
        <label>Arbeitsort (Adresse)</label>
        <input className="input" name="workplaceAddress" required maxLength={256} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        <div>
          <label>PLZ</label>
          <input className="input" name="workplacePostalCode" />
        </div>
        <div>
          <label>Ort</label>
          <input className="input" name="workplaceCity" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div>
          <label>Max. Warmmiete (€)</label>
          <input className="input" type="number" name="maxWarmmieteEuros" defaultValue={900} min={100} max={10000} />
        </div>
        <div>
          <label>Max. Anfahrt (min)</label>
          <input className="input" type="number" name="maxCommuteMinutes" defaultValue={35} min={1} max={240} />
        </div>
        <div>
          <label>Min. Zimmer</label>
          <input className="input" type="number" step="0.5" name="minRooms" defaultValue={1} />
        </div>
        <div>
          <label>Wunsch-Zimmer</label>
          <input className="input" type="number" step="0.5" name="preferredRooms" defaultValue={2} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div>
          <label>Erwachsene</label>
          <input className="input" type="number" name="adults" defaultValue={1} min={1} max={10} />
        </div>
        <div>
          <label>Kinder</label>
          <input className="input" type="number" name="children" defaultValue={0} min={0} max={10} />
        </div>
        <div>
          <label>Möbliert</label>
          <select className="input" name="furnished" defaultValue="PREFERRED">
            <option value="REQUIRED">Erforderlich</option>
            <option value="PREFERRED">Bevorzugt</option>
            <option value="EITHER">Egal</option>
          </select>
        </div>
        <div>
          <label>WBS</label>
          <select className="input" name="wbsStatus" defaultValue="UNKNOWN">
            <option value="UNKNOWN">Unbekannt</option>
            <option value="AVAILABLE">Vorhanden</option>
            <option value="NOT_AVAILABLE">Nicht vorhanden</option>
          </select>
        </div>
      </div>
      <button type="submit" className="btn primary">
        Kandidat anlegen & Suchlauf starten
      </button>
    </form>
  );
}
