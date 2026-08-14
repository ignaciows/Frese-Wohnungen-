'use client';

import { useState, useTransition } from 'react';
import { setListingAvailableFromAction } from '../actions';

/**
 * "Frei ab" for a flat whose advert never said.
 *
 * Most adverts print no move-in date, and without one the flat cannot be
 * placed against the arrival: it sits on the line saying "kein Datum" and the
 * timing part of its score is guesswork. But the colleague who has just been
 * on the telephone to the landlord knows the date. This is the smallest
 * possible way to write it down — one field, one press, and the row on the
 * line moves.
 *
 * Closed by default: an open date field on every row would turn the timeline
 * into a form. It opens where the date is missing, which is where it is worth
 * asking for.
 */
export function AvailableFromPicker({
  listingId,
  current,
  compact,
}: {
  listingId: string;
  /** What the listing says today, or null when the advert named no date. */
  current: Date | null;
  /** On the timeline the control has to fit under two lines of flat title. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const value = dateInputValue(current);

  if (!open) {
    return (
      <button
        type="button"
        className={`afp-open${compact ? ' sm' : ''}`}
        onClick={() => setOpen(true)}
        title="Einzugsdatum von Hand eintragen"
      >
        {value ? '✎ Datum ändern' : '＋ Frei ab eintragen'}
      </button>
    );
  }

  return (
    <form
      className={`afp${compact ? ' sm' : ''}`}
      action={(formData) =>
        startTransition(async () => {
          await setListingAvailableFromAction(formData);
          setOpen(false);
        })
      }
    >
      <input type="hidden" name="listingId" value={listingId} />
      <input
        type="date"
        name="availableFrom"
        className="input afp-date"
        defaultValue={value}
        aria-label="Frei ab"
        autoFocus
      />
      <button type="submit" className="btn sm primary" disabled={pending}>
        {pending ? '…' : 'Setzen'}
      </button>
      {/* A symbol, not the word: on the timeline the whole control has to fit
          in the 290px label column, and "Abbrechen" wrapped to its own line. */}
      <button
        type="button"
        className="afp-cancel"
        onClick={() => setOpen(false)}
        disabled={pending}
        title="Abbrechen"
        aria-label="Abbrechen"
      >
        ✕
      </button>
    </form>
  );
}

/**
 * A Date as the yyyy-mm-dd an <input type="date"> expects.
 *
 * Kept private to this file: a plain function exported from a 'use client'
 * module cannot be called from a server component, only rendered.
 */
function dateInputValue(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
