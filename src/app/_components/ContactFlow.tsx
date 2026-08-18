'use client';

import { useState, useTransition } from 'react';
import { claimListingAction, confirmContactAction, sendAnfrageAction } from '@/app/actions';
import { telHref } from '@/domain/contact';

/**
 * Contacting a landlord, by whichever route the ad actually allows.
 *
 * When the ad publishes an address, the message goes out from here in one
 * click and the contact, the follow-up and the reply-matching are all set up
 * automatically — that is the whole point of the tool.
 *
 * When it does not — which is most large portals, because they deliberately
 * keep enquiries inside their own form — the older flow stands: copy the text,
 * open the ad, come back and confirm. Opening an ad never counts as
 * contacting it; only an explicit confirmation does.
 *
 * And when the ad prints a phone number, that goes at the very top, above
 * everything else. A form message is answered on Thursday; a call is answered
 * now, and for the flats worth having that is the whole difference. The number
 * is only ever one the ad itself published — see domain/contact.
 */
export function ContactFlow({
  candidateCaseId,
  listingId,
  listingUrl,
  message,
  status,
  alreadyContactedWarning,
  contactEmail,
  contactPhone,
  contactName,
  sendingEnabled,
}: {
  candidateCaseId: string;
  listingId: string;
  listingUrl: string;
  message: string;
  status: string;
  alreadyContactedWarning?: string | null;
  /** Address published by the ad itself, when there is one. */
  contactEmail?: string | null;
  /** Phone number the ad published, normalised. */
  contactPhone?: string | null;
  /** Who to ask for, when the ad names somebody. */
  contactName?: string | null;
  /** Whether an admin has configured and switched on sending. */
  sendingEnabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const [showConfirm, setShowConfirm] = useState(status === 'IN_PROGRESS');
  const [showFallback, setShowFallback] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);

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

  const canSendFromApp = !!contactEmail && !!sendingEnabled;

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

  function sendFromApp() {
    if (!message.trim()) {
      alert('Es ist noch kein Anschreiben hinterlegt. Bitte zuerst unter „Anschreiben“ einfügen.');
      return;
    }
    const fd = new FormData();
    fd.set('candidateCaseId', candidateCaseId);
    fd.set('listingId', listingId);
    start(async () => {
      const result = await sendAnfrageAction(fd);
      setSendResult(
        result.ok
          ? {
              ok: true,
              text: `Anfrage an ${result.sentTo} gesendet. Wiedervorlage „Antwort prüfen" steht für den ${new Date(
                result.followUpAt,
              ).toLocaleDateString('de-DE')}.`,
            }
          : { ok: false, text: result.reason },
      );
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

      {contactPhone ? (
        <div className="callout success">
          <span className="callout-icon" aria-hidden>
            ☎
          </span>
          <div className="stack-sm grow">
            <strong>
              Diese Anzeige nennt eine Telefonnummer{contactName ? ` — ${contactName}` : ''}.
            </strong>
            <a href={telHref(contactPhone)} className="btn primary block">
              {contactPhone} anrufen ☎
            </a>
            <span className="small muted">
              Schneller als jedes Formular. Danach unten „Kontakt bestätigen“ — dann laufen Verlauf und
              Wiedervorlage genauso wie bei einer gesendeten Anfrage.
            </span>
          </div>
        </div>
      ) : null}

      {canSendFromApp ? (
        <>
          <button type="button" className="btn primary lg block" onClick={sendFromApp} disabled={pending}>
            {pending ? 'Sendet …' : `Anfrage direkt senden an ${contactEmail} ✉`}
          </button>
          <span className="small muted">
            Geht aus dem gemeinsamen Postfach raus. Kontakt, Wiedervorlage und Antwort-Zuordnung passieren
            automatisch — kein Portal-Tab nötig.
          </span>
        </>
      ) : null}

      {sendResult ? (
        <div className={sendResult.ok ? 'callout success' : 'callout danger'}>
          <span className="callout-icon" aria-hidden>
            {sendResult.ok ? '✓' : '!'}
          </span>
          <div>{sendResult.text}</div>
        </div>
      ) : null}

      {!canSendFromApp && contactEmail && !sendingEnabled ? (
        <div className="callout info">
          <span className="callout-icon" aria-hidden>
            i
          </span>
          <div>
            Diese Anzeige nennt eine E-Mail-Adresse. Sobald in den Einstellungen ein Postfach hinterlegt
            und der Versand aktiviert ist, kann die Anfrage direkt von hier rausgehen.
          </div>
        </div>
      ) : null}

      {/* Three steps, always visible, with the current one lit.
          The flow was already correct and completely invisible: one button that
          opened a portal tab, and a confirmation box that only existed after
          you pressed it. "Wie schicke ich eine Anfrage, und woher weiß ich, was
          daraus wurde?" had no answer on screen. Now the screen is the answer. */}
      <ol className="flow">
        <li className={`flow-step ${showConfirm ? 'done' : 'now'}`}>
          <span className="flow-num" aria-hidden>
            {showConfirm ? '✓' : '1'}
          </span>
          <div className="flow-main">
            <strong>Anschreiben kopieren &amp; Anzeige öffnen</strong>
            <button
              type="button"
              className={canSendFromApp ? 'btn block' : 'btn primary block'}
              onClick={openAndContact}
              disabled={pending}
            >
              {pending ? 'Öffnet …' : 'Kopieren & öffnen ↗'}
            </button>
          </div>
        </li>

        <li className={`flow-step ${showConfirm ? 'now' : ''}`}>
          <span className="flow-num" aria-hidden>
            2
          </span>
          <div className="flow-main">
            <strong>Im Portal einfügen (⌘V) und abschicken</strong>
            <span className="small muted">
              {contactEmail
                ? 'Passiert im Tab des Portals.'
                : 'Diese Anzeige nennt keine Adresse — die Anfrage läuft über das Formular des Portals.'}
            </span>
          </div>
        </li>

        <li className={`flow-step ${showConfirm ? 'now' : ''}`}>
          <span className="flow-num" aria-hidden>
            3
          </span>
          <div className="flow-main">
            <strong>Hier bestätigen</strong>
            <span className="small muted">
              Danach steht sie unter „Anfragen“, das Anschreiben wird unveränderlich mitgespeichert und
              die Erinnerung „Antwort prüfen“ läuft automatisch.
            </span>
          </div>
        </li>
      </ol>

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
        <div className="card" style={{ borderColor: 'var(--brand)' }}>
          <div className="card-body stack-sm">
            <h4>Schritt 3 — abgeschickt?</h4>
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
