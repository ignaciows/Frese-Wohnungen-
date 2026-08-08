'use client';

import { useState } from 'react';
import { importListingAction } from '@/app/actions';
import { SourceTask, type SourceTaskData } from './SourceTask';

const GROUPS: Array<{ key: string; label: string; cats: string[] }> = [
  { key: 'market', label: 'Große Portale', cats: ['MARKETPLACE', 'GENERAL_PORTAL'] },
  { key: 'furnished', label: 'Möbliert & Relocation', cats: ['FURNISHED'] },
  { key: 'landlord', label: 'Vermieter & Genossenschaften', cats: ['INSTITUTIONAL_LANDLORD', 'COOPERATIVE', 'MUNICIPAL'] },
  { key: 'local', label: 'Regional & lokal', cats: ['SOCIAL_LOCAL', 'DIRECTORY'] },
  { key: 'temp', label: 'Übergangswohnen', cats: ['TEMPORARY'] },
];

export function SourceBoard({ tasks }: { tasks: SourceTaskData[] }) {
  const [importFor, setImportFor] = useState<{ id: string; name: string } | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);

  const visible = onlyOpen
    ? tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS')
    : tasks;

  const grouped = GROUPS.map((g) => ({
    ...g,
    items: visible.filter((t) => g.cats.includes(t.source.category)),
  })).filter((g) => g.items.length > 0);

  const nextTask = tasks.find((t) => t.status === 'PENDING');

  return (
    <div className="stack-lg">
      <div className="row-between">
        <div className="checkline">
          <input
            id="onlyOpen"
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
          />
          <label htmlFor="onlyOpen">Nur offene Quellen zeigen</label>
        </div>
        {nextTask ? (
          <a
            href={nextTask.generatedUrl ?? nextTask.source.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn primary"
          >
            Nächste Quelle öffnen: {nextTask.source.name} ↗
          </a>
        ) : (
          <span className="badge success">✓ Alle Quellen bearbeitet</span>
        )}
      </div>

      {importFor ? (
        <div className="card" style={{ borderColor: 'var(--brand-border)' }}>
          <div className="card-head">
            <h2>Anzeige importieren — {importFor.name}</h2>
            <button type="button" className="btn ghost sm" onClick={() => setImportFor(null)}>
              Schließen
            </button>
          </div>
          <form action={importListingAction} className="card-body stack">
            <input type="hidden" name="sourceId" value={importFor.id} />
            <div>
              <label htmlFor="rawUrl">Link zur Anzeige *</label>
              <input id="rawUrl" name="rawUrl" type="url" className="input" required placeholder="https://…" />
            </div>
            <div>
              <label htmlFor="title">Titel der Anzeige *</label>
              <input id="title" name="title" className="input" required placeholder="3-Zimmer-Wohnung mit EBK …" />
            </div>
            <div>
              <label htmlFor="descriptionRaw">Beschreibungstext aus der Anzeige *</label>
              <textarea
                id="descriptionRaw"
                name="descriptionRaw"
                className="textarea"
                style={{ minHeight: 150 }}
                required
                placeholder="Text der Anzeige hier einfügen — daraus liest die App Möblierung, Warmmiete, Zimmer, WBS-Pflicht usw. heraus."
              />
              <p className="field-hint">
                Je vollständiger der Text, desto besser die automatische Auswertung. Preis, Zimmer und
                Möblierung werden daraus erkannt.
              </p>
            </div>
            <div className="grid-3">
              <div>
                <label htmlFor="locationRaw">Ort (wie angegeben)</label>
                <input id="locationRaw" name="locationRaw" className="input" placeholder="74906 Bad Rappenau" />
              </div>
              <div>
                <label htmlFor="locationCity">Stadt</label>
                <input id="locationCity" name="locationCity" className="input" />
              </div>
              <div>
                <label htmlFor="locationPostal">PLZ</label>
                <input id="locationPostal" name="locationPostal" className="input" />
              </div>
            </div>
            <div className="row">
              <button type="submit" className="btn primary">
                Importieren &amp; bewerten
              </button>
              <span className="small muted">
                Doppelte Links werden automatisch erkannt und nicht doppelt angelegt.
              </span>
            </div>
          </form>
        </div>
      ) : null}

      {grouped.map((g) => (
        <section key={g.key} className="stack">
          <div className="row">
            <h2>{g.label}</h2>
            <span className="badge">{g.items.length}</span>
          </div>
          <div className="stack">
            {g.items.map((t) => (
              <SourceTask
                key={t.id}
                task={t}
                onImport={(id, name) => {
                  setImportFor({ id, name });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            ))}
          </div>
        </section>
      ))}

      {grouped.length === 0 ? (
        <div className="card card-pad">
          <p className="muted">Keine offenen Quellen — alle wurden bereits bearbeitet.</p>
        </div>
      ) : null}
    </div>
  );
}
