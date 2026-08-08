'use client';

import { useState, useTransition } from 'react';
import { claimListingAction, confirmContactAction } from '@/app/actions';

/**
 * The deliberate one-by-one contact flow:
 *   1. copy the message   2. open the listing   3. mark IN_PROGRESS
 *   4. only an explicit confirmation sets CONTACTED.
 * Opening never marks a listing as contacted.
 */
export function ContactFlow({
  candidateCaseId,
  listingId,
  listingUrl,
  message,
  status,
  alreadyContactedWarning,
}: {
  candidateCaseId: string;
  listingId: string;
  listingUrl: string;
  message: string;
  status: string;
  alreadyContactedWarning?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [showConfirm, setShowConfirm] = useState(status === 'IN_PROGRESS');
  const [showFallback, setShowFallback] = useState(false);

  if (status === 'CONTACTED') {
    return (
      <div className="callout success">
        <span className="callout-icon" aria-hidden>
          ✓
        </span>
        <div>Diese Wohnung wurde bereits kontaktiert. Den Verlauf findest du unter „Kontakte“.</div>
      </div>
    );
  }

  async function openAndContact() {
    if (!message.trim()) {
      alert('Es ist noch kein Anschreiben hinterlegt. Bitte zuerst unter „Anschreiben“ einfügen.');
      return;
    }
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setShowFallback(true);
    }
    window.open(listingUrl, '_blank', 'noopener,noreferrer');
    const fd = new FormData();
    fd.set('candidateCaseId', candidateCaseId);
    fd.set('listingId', listingId);
    start(async () => {
      await claimListingAction(fd);
      setShowConfirm(true);
    });
  }

  return (
    <div className="stack">
      {alreadyContactedWarning ? (
        <div className="callout danger">
          <span className="callout-icon" aria-hidden>
            !
          </span>
          <div>{alreadyContactedWarning}</div>
        </div>
      ) : null}

      <button type="button" className="btn primary lg block" onClick={openAndContact} disabled={pending}>
        {pending ? 'Öffnet …' : 'Anschreiben kopieren & Anzeige öffnen ↗'}
      </button>

      {copied ? (
        <div className="callout success">
          <span className="callout-icon" aria-hidden>
            ✓
          </span>
          <div>Anschreiben ist in der Zwischenablage. Füge es im Portal-Formular ein (⌘V).</div>
        </div>
      ) : null}

      {showFallback ? (
        <div className="stack-sm">
          <div className="callout warning">
            <span className="callout-icon" aria-hidden>
              !
            </span>
            <div>Zwischenablage blockiert — Text hier markieren und mit ⌘C kopieren:</div>
          </div>
          <textarea className="textarea" readOnly value={message} style={{ minHeight: 120 }} />
        </div>
      ) : null}

      {showConfirm ? (
        <div className="card" style={{ borderColor: 'var(--brand-border)' }}>
          <div className="card-body stack-sm">
            <h4>Hast du die Nachricht wirklich abgeschickt?</h4>
            <p className="small muted">
              Nur eine ausdrückliche Bestätigung setzt den Status auf „Kontaktiert“ und speichert das
              Anschreiben unveränderlich mit.
            </p>
            <div className="row">
              <form action={confirmContactAction}>
                <input type="hidden" name="candidateCaseId" value={candidateCaseId} />
                <input type="hidden" name="listingId" value={listingId} />
                <button type="submit" className="btn primary">
                  Ja, Nachricht wurde gesendet
                </button>
              </form>
              <button type="button" className="btn ghost" onClick={() => setShowConfirm(false)}>
                Noch nicht
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
