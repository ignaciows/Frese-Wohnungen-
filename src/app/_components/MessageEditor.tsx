'use client';

import { useEffect, useRef, useState } from 'react';
import { saveMessageAction } from '@/app/actions';

export function MessageEditor({
  candidateCaseId,
  initialBody,
}: {
  candidateCaseId: string;
  initialBody: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialBody);

  // Debounced autosave. Never loses text: on failure we stay "dirty" and retry
  // on the next keystroke or via the explicit save button.
  useEffect(() => {
    if (body === lastSaved.current) return;
    setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(body), 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  async function save(text: string) {
    setState('saving');
    try {
      const fd = new FormData();
      fd.set('candidateCaseId', candidateCaseId);
      fd.set('body', text);
      await saveMessageAction(fd);
      lastSaved.current = text;
      setState('saved');
    } catch {
      setState('error');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — select the text so the user can copy manually.
      const el = document.getElementById('anschreiben') as HTMLTextAreaElement | null;
      el?.select();
    }
  }

  const status = {
    saved: { text: '✓ Gespeichert', cls: 'badge success' },
    dirty: { text: 'Nicht gespeichert', cls: 'badge warning' },
    saving: { text: 'Speichert …', cls: 'badge' },
    error: { text: '! Speichern fehlgeschlagen', cls: 'badge danger' },
  }[state];

  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <h2>Anschreiben</h2>
          <span className={status.cls}>{status.text}</span>
        </div>
        <div className="row">
          <span className="small subtle">{body.trim().length} Zeichen</span>
          <button type="button" className="btn sm" onClick={copy} disabled={!body.trim()}>
            {copied ? '✓ Kopiert' : 'Kopieren'}
          </button>
        </div>
      </div>
      <div className="card-body">
        <label htmlFor="anschreiben">
          Fertigen Text einfügen — Zeilenumbrüche bleiben erhalten
        </label>
        <textarea
          id="anschreiben"
          className="textarea"
          style={{ minHeight: 340, fontSize: 14 }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            'Sehr geehrte Damen und Herren,\n\nwir möchten eine Wohnung für unsere Pflegekraft anmieten …'
          }
        />
        <p className="field-hint">
          Dieser Text wird bei jedem bestätigten Kontakt wortgetreu mitgespeichert. Er verlässt die App nie
          und wird an keinen externen Dienst gesendet.
        </p>
      </div>
      {state !== 'saved' ? (
        <div className="card-foot">
          <button type="button" className="btn primary sm" onClick={() => void save(body)}>
            Jetzt speichern
          </button>
        </div>
      ) : null}
    </div>
  );
}
