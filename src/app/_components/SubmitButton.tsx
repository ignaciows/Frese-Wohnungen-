'use client';

/**
 * Ein Absende-Knopf, der zugibt, dass er gedrückt wurde.
 *
 * Der Grund steht in `docs/OBERFLAECHE.md` unter 2.1: wer klickt und innerhalb
 * einer Zehntelsekunde nichts sieht, klickt noch einmal. Das ist keine
 * Ungeduld, das ist Reflex — und bei „Anfrage senden" heißt zweimal klicken
 * zwei Anfragen an denselben Vermieter.
 *
 * Server Actions in Next.js schicken das Formular ab und zeichnen die Seite
 * danach neu. Dazwischen liegt eine Netzwerkrunde, in der vorher überhaupt
 * nichts passierte: der Knopf sah aus wie vorher, die Seite auch.
 *
 * `useFormStatus` kennt diesen Zwischenzustand, ohne dass irgendwo ein
 * `useState` mitgeführt werden muss. Der Knopf muss dafür ein eigenes
 * Client-Bauteil *innerhalb* des Formulars sein — der Hook liest den Status
 * des Formulars über sich, nicht den eines übergebenen Props.
 */

import { useFormStatus } from 'react-dom';

export function SubmitButton({
  children,
  className = 'btn',
  pendingLabel,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  /** Was während des Wartens dasteht. Ohne Angabe bleibt die Beschriftung stehen. */
  pendingLabel?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      // Gesperrt, solange es läuft — das verhindert den zweiten Klick, und
      // zwar zuverlässiger als jede Absichtserklärung.
      disabled={pending || rest.disabled}
      aria-busy={pending || undefined}
      className={`${className} ${pending ? 'is-pending' : ''}`}
      {...rest}
    >
      {/* Der Kreisel steht *vor* der Beschriftung und schiebt sie nicht weg:
          ein Knopf, der beim Drücken seine Breite ändert, wandert unter dem
          Finger weg. */}
      {pending ? <span className="spinner" aria-hidden /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
