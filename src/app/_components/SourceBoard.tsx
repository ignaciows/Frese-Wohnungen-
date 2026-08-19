'use client';

import { useState } from 'react';
import { importListingAction } from '@/app/actions';
import { SourceTask, type SourceTaskData } from './SourceTask';
import { SubmitButton } from '@/app/_components/SubmitButton';

/**
 * Die Aufgabenliste eines Suchlaufs: eine Karte pro Portal.
 *
 * Früher standen die Aufgaben in fünf Kategorie-Gruppen — sinnvoll bei fünfzig
 * Quellen, albern bei dreien. Jetzt ist es einfach eine Liste in der Reihenfolge
 * des Katalogs.
 */
export function SourceBoard({ tasks }: { tasks: SourceTaskData[] }) {
  const [importFor, setImportFor] = useState<{ id: string; name: string } | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);

  const visible = onlyOpen
    ? tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS')
    : tasks;

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
            href={nextTask.source.websiteUrl}
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
              <SubmitButton className="btn primary">
                Importieren &amp; bewerten
              </SubmitButton>
              <span className="small muted">
                Doppelte Links werden automatisch erkannt und nicht doppelt angelegt.
              </span>
            </div>
          </form>
        </div>
      ) : null}

      <section className="stack">
        <div className="stack">
          {visible.map((t) => (
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

      {visible.length === 0 ? (
        <div className="card card-pad">
          <p className="muted">Keine offenen Quellen — alle wurden bereits bearbeitet.</p>
        </div>
      ) : null}
    </div>
  );
}
