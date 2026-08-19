'use client';

import { useState } from 'react';
import {
  addContactMessageAction,
  setContactOutcomeAction,
  markRegisteredAction,
  markRepliesReadAction,
} from '@/app/actions';
import { CopyFields } from './CopyFields';
import { RESPONSE_OUTCOME, formatDateTime, formatDate } from '@/lib/labels';
import { SubmitButton } from '@/app/_components/SubmitButton';

export interface ConversationData {
  id: string;
  listingTitle: string;
  listingUrl: string;
  sourceName: string;
  location: string;
  contactedAt: string;
  contactedByName: string;
  outcome: string;
  outcomeAt: string | null;
  outcomeByName: string | null;
  outcomeNote: string | null;
  messageSnapshot: string;
  /** Inbound messages nobody has opened yet — the badge, like a mail client. */
  unread: number;
  /** Days since the enquiry went out with nothing back. Null once answered. */
  waitingDays: number | null;
  /** True once the three days are up and there is still no reply. */
  dueForCheck: boolean;
  transfer: { id: string; objectLabel: string; link: string; location: string; registeredAt: string | null; registeredByName: string | null } | null;
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    occurredAt: string;
    recordedByName: string;
  }>;
}

const OUTCOMES = ['POSITIVE', 'NEEDS_INFO', 'NEGATIVE', 'AWAITING'] as const;

export function ConversationCard({ c }: { c: ConversationData }) {
  const [showThread, setShowThread] = useState(c.messages.length > 0 || c.outcome !== 'AWAITING');
  // Held locally so the badge clears the moment the thread opens; the server
  // is told straight after. Without this the count only ever went up — the
  // action existed and nothing called it.
  const [unread, setUnread] = useState(c.unread);

  async function openThread() {
    const next = !showThread;
    setShowThread(next);
    if (next && unread > 0) {
      setUnread(0);
      const fd = new FormData();
      fd.set('contactAttemptId', c.id);
      try {
        await markRepliesReadAction(fd);
      } catch {
        // A failed read receipt must never swallow the reply itself.
      }
    }
  }
  const o = RESPONSE_OUTCOME[c.outcome] ?? RESPONSE_OUTCOME.AWAITING;

  return (
    <div className="card" id={`kontakt-${c.id}`}>
      <div className="card-head">
        <div className="grow stack-sm" style={{ minWidth: 0 }}>
          <div className="row-wrap">
            {/* The count of unread replies, where a mail client would put it.
                This is the one thing somebody opening this page is looking
                for, and it used to be buried inside a collapsed thread. */}
            {unread > 0 ? (
              <span className="unread-badge" title="Neue Antwort">
                {unread}
              </span>
            ) : null}
            <h3 style={{ overflowWrap: 'anywhere' }}>{c.listingTitle}</h3>
            {unread > 0 ? (
              <span className="badge success">Neue Antwort</span>
            ) : (
              <span className={`badge ${o.tone}`}>
                {o.icon} {o.label}
              </span>
            )}
            {/* How long this has been quiet, said in the unit a person thinks
                in. The reminder fires at three days; before that this is just
                context, after it it is the thing to act on. */}
            {c.waitingDays != null ? (
              <span className={`badge ${c.dueForCheck ? 'warning' : ''}`}>
                {c.waitingDays === 0
                  ? 'heute gesendet'
                  : `seit ${c.waitingDays} ${c.waitingDays === 1 ? 'Tag' : 'Tagen'} keine Antwort`}
              </span>
            ) : null}
          </div>
          <div className="small muted">
            {c.sourceName} · {c.location} · kontaktiert {formatDate(c.contactedAt)} von {c.contactedByName}
          </div>
        </div>
        <a href={c.listingUrl} target="_blank" rel="noopener noreferrer" className="btn sm">
          Anzeige ↗
        </a>
      </div>

      <div className="card-body stack">
        {/* --- outcome selector -------------------------------------------- */}
        <div>
          <label>Rückmeldung des Vermieters</label>
          <div className="row-wrap">
            {OUTCOMES.map((key) => {
              const cfg = RESPONSE_OUTCOME[key];
              const active = c.outcome === key;
              return (
                <form key={key} action={setContactOutcomeAction}>
                  <input type="hidden" name="contactAttemptId" value={c.id} />
                  <input type="hidden" name="outcome" value={key} />
                  <SubmitButton
                    className={`btn sm ${active ? 'primary' : ''}`}
                    aria-pressed={active}
                  >
                    {cfg.icon} {cfg.label}
                  </SubmitButton>
                </form>
              );
            })}
          </div>
          {c.outcomeAt ? (
            <p className="field-hint">
              Zuletzt aktualisiert {formatDateTime(c.outcomeAt)}
              {c.outcomeByName ? ` von ${c.outcomeByName}` : ''}
            </p>
          ) : null}
        </div>

        {/* --- conversation ------------------------------------------------ */}
        <div>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void openThread()}
            aria-expanded={showThread}
          >
            {showThread ? '− Verlauf ausblenden' : `+ Verlauf (${c.messages.length + 1})`}
          </button>
        </div>

        {showThread ? (
          <div className="stack">
            <div className="thread">
              <div className="bubble out">
                {c.messageSnapshot}
                <div className="bubble-meta">
                  Anschreiben · {formatDateTime(c.contactedAt)} · {c.contactedByName}
                </div>
              </div>
              {c.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.direction === 'OUTGOING' ? 'out' : 'in'}`}>
                  {m.body}
                  <div className="bubble-meta">
                    {m.direction === 'OUTGOING' ? 'Von uns' : 'Vom Vermieter'} ·{' '}
                    {formatDateTime(m.occurredAt)} · erfasst von {m.recordedByName}
                  </div>
                </div>
              ))}
            </div>

            <form action={addContactMessageAction} className="stack-sm">
              <input type="hidden" name="contactAttemptId" value={c.id} />
              <label htmlFor={`msg-${c.id}`}>Nachricht festhalten</label>
              <textarea
                id={`msg-${c.id}`}
                name="body"
                className="textarea"
                style={{ minHeight: 70 }}
                required
                placeholder="Antwort des Vermieters hier einfügen oder zusammenfassen …"
              />
              <div className="row">
                <select name="direction" className="select" style={{ width: 190 }} defaultValue="INCOMING">
                  <option value="INCOMING">Antwort vom Vermieter</option>
                  <option value="OUTGOING">Nachricht von uns</option>
                </select>
                <SubmitButton className="btn primary sm">
                  Hinzufügen
                </SubmitButton>
              </div>
            </form>
          </div>
        ) : null}

        {/* --- company system transfer ------------------------------------- */}
        {c.transfer ? (
          <>
            <CopyFields
              objectLabel={c.transfer.objectLabel}
              link={c.transfer.link}
              location={c.transfer.location}
            />
            {c.transfer.registeredAt ? (
              <div className="callout success">
                <span className="callout-icon" aria-hidden>
                  ✓
                </span>
                <div>
                  Im Firmen-System eingetragen am {formatDateTime(c.transfer.registeredAt)}
                  {c.transfer.registeredByName ? ` von ${c.transfer.registeredByName}` : ''}.
                </div>
              </div>
            ) : (
              <form action={markRegisteredAction}>
                <input type="hidden" name="contactAttemptId" value={c.id} />
                <SubmitButton className="btn block">
                  Als im Firmen-System eingetragen markieren
                </SubmitButton>
              </form>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
