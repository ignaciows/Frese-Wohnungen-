'use client';

import { useState } from 'react';

/**
 * The three fields that get typed into the separate company system.
 * There is deliberately no API integration — this panel just makes the
 * manual transfer effortless.
 */
export function CopyFields({
  objectLabel,
  link,
  location,
}: {
  objectLabel: string;
  link: string;
  location: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const fields = [
    { key: 'obj', label: 'Wohnung/Objekt', value: objectLabel },
    { key: 'link', label: 'Link', value: link },
    { key: 'loc', label: 'Ort', value: location },
  ];
  const combined = fields.map((f) => `${f.label}: ${f.value}`).join('\n');

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied('fallback');
    }
  }

  return (
    <div className="card" style={{ borderColor: 'var(--brand-border)' }}>
      <div className="card-head" style={{ background: 'var(--brand-soft)' }}>
        <h3>Für Firmen-System kopieren</h3>
        <button type="button" className="btn soft sm" onClick={() => copy('all', combined)}>
          {copied === 'all' ? '✓ Kopiert' : 'Alles kopieren'}
        </button>
      </div>
      <div className="card-body stack-sm">
        {fields.map((f) => (
          <div key={f.key} className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small subtle">{f.label}</div>
              <div className="pre-wrap small" style={{ fontWeight: 500 }}>
                {f.value}
              </div>
            </div>
            <button type="button" className="btn sm" onClick={() => copy(f.key, f.value)}>
              {copied === f.key ? '✓' : 'Kopieren'}
            </button>
          </div>
        ))}
        {copied === 'fallback' ? (
          <textarea className="textarea" readOnly value={combined} style={{ minHeight: 90 }} />
        ) : null}
      </div>
    </div>
  );
}
