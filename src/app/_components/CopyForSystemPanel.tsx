'use client';

import { useState, useTransition } from 'react';

interface Props {
  transfer: {
    objectLabel: string;
    link: string;
    location: string;
    registeredAt: Date | null;
  };
  contactAttemptId: string;
  markAction: (formData: FormData) => Promise<void>;
}

export function CopyForSystemPanel({ transfer, contactAttemptId, markAction }: Props) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function copy(value: string, field: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      setCopiedField('__failed__');
    }
  }

  const combined = `Wohnung/Objekt: ${transfer.objectLabel}\nLink: ${transfer.link}\nOrt: ${transfer.location}`;

  return (
    <section
      className="card"
      style={{
        padding: 12,
        borderColor: 'var(--accent)',
        background: 'color-mix(in oklab, var(--accent) 6%, transparent)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong>Für Firmen-System kopieren</strong>
        {transfer.registeredAt ? (
          <span className="status-contacted" style={{ fontSize: 12 }}>
            ✓ eingetragen am {new Date(transfer.registeredAt).toLocaleString('de-DE')}
          </span>
        ) : null}
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <tbody>
          <Row label="Wohnung/Objekt" value={transfer.objectLabel} onCopy={() => copy(transfer.objectLabel, 'obj')} copied={copiedField === 'obj'} />
          <Row label="Link" value={transfer.link} onCopy={() => copy(transfer.link, 'link')} copied={copiedField === 'link'} />
          <Row label="Ort" value={transfer.location} onCopy={() => copy(transfer.location, 'loc')} copied={copiedField === 'loc'} />
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button type="button" className="btn small" onClick={() => copy(combined, 'all')}>
          Alles kopieren
        </button>
        {copiedField === 'all' ? <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>Kopiert.</span> : null}
        {copiedField === '__failed__' ? (
          <span style={{ color: 'var(--danger)', fontSize: 11, alignSelf: 'center' }}>
            Zwischenablage blockiert — Text markieren.
          </span>
        ) : null}
        {!transfer.registeredAt ? (
          <button
            type="button"
            className="btn small primary"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const fd = new FormData();
                fd.set('contactAttemptId', contactAttemptId);
                await markAction(fd);
              })
            }
          >
            Als eingetragen markieren
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Row({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '4px 6px', color: 'var(--muted)', width: '30%' }}>{label}</td>
      <td style={{ padding: '4px 6px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{value}</td>
      <td style={{ padding: '4px 6px', width: 90, textAlign: 'right' }}>
        <button type="button" className="btn small" onClick={onCopy}>
          {copied ? '✓ Kopiert' : 'Kopieren'}
        </button>
      </td>
    </tr>
  );
}
