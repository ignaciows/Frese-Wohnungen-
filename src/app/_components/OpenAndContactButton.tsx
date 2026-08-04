'use client';

import { useState } from 'react';
import { claimListingAction } from '../actions';

interface Props {
  messageBody: string;
  openUrl: string;
  candidateCaseId: string;
  listingId: string;
}

/**
 * Copies the current application message to the clipboard, opens the listing
 * in a new tab (using the user's normal browser session), and claims the
 * listing in our DB so colleagues see it as In-Progress.
 *
 * Deliberately does *not* mark the listing as contacted. The colleague still
 * has to confirm via "Kontakt bestätigen".
 */
export function OpenAndContactButton({ messageBody, openUrl, candidateCaseId, listingId }: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);

  async function handle() {
    setError(null);
    setCopied(false);
    setFallback(false);
    try {
      if (!messageBody.trim()) {
        setError('Anschreiben ist leer — bitte zuerst speichern.');
        return;
      }
      try {
        await navigator.clipboard.writeText(messageBody);
        setCopied(true);
      } catch {
        // Clipboard blocked (permissions, http, etc). Show fallback selectable
        // area rather than silently failing.
        setFallback(true);
      }
      // Fire-and-forget claim; server action returns void.
      const form = new FormData();
      form.set('candidateCaseId', candidateCaseId);
      form.set('listingId', listingId);
      await claimListingAction(form);
      window.open(openUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler beim Öffnen.');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <button type="button" className="btn primary small" onClick={handle}>
        ↗ Öffnen & Nachricht kopieren
      </button>
      {copied ? <span className="muted" style={{ fontSize: 11 }}>Nachricht ist in der Zwischenablage.</span> : null}
      {error ? <span style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</span> : null}
      {fallback ? (
        <div style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>Zwischenablage nicht verfügbar — bitte Text markieren:</span>
          <textarea readOnly value={messageBody} className="textarea" style={{ minHeight: 80 }} />
        </div>
      ) : null}
    </div>
  );
}
