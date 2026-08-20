'use client';

/**
 * Der Bildschirm, den es bisher nicht gab.
 *
 * Bricht eine Server-Aktion oder eine Seite mit einer Ausnahme ab, zeigt
 * Next.js von sich aus eine leere weiße Seite mit einer englischen Zeile und
 * einer Prüfziffer: „Application error: a server-side exception has occurred …
 * Digest: 3610855577". Kein Weg zurück, keine Navigation, kein Hinweis, ob es
 * an der Eingabe lag oder am Server — dreimal ist genau das jemandem mitten in
 * der Arbeit passiert, und jedes Mal war der Bildschirm danach weiß.
 *
 * Hier steht stattdessen, was passiert ist, was mit den Eingaben von eben ist,
 * und zwei Wege weiter. Die Prüfziffer bleibt sichtbar — klein —, weil sie im
 * Server-Protokoll steht und die Zeile ist, mit der sich der Fehler finden
 * lässt.
 */

import { useEffect } from 'react';
import Link from 'next/link';

export default function Fehlerseite({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Landet in der Browser-Konsole; der Server hat denselben Fehler bereits
    // mit vollem Stapel protokolliert.
    console.error('[Seitenfehler]', error);
  }, [error]);

  return (
    <main className="container page" style={{ maxWidth: 640 }}>
      <div className="card card-pad stack">
        <h1 style={{ marginBottom: 4 }}>Da ist etwas schiefgegangen</h1>
        <p>
          Der letzte Schritt konnte nicht abgeschlossen werden. Es liegt nicht an dir — und es ist nichts
          kaputtgegangen: gespeichert wurde nichts, was nicht vollständig durchgelaufen ist.
        </p>
        <p className="small muted">
          Was du gerade eingetippt hattest, ist nicht gespeichert. Wenn es beim zweiten Versuch wieder
          passiert, schick die Zeile unten mit — damit lässt sich der Fehler im Protokoll finden.
        </p>
        <div className="row-wrap" style={{ marginTop: 8 }}>
          <button type="button" className="btn primary" onClick={reset}>
            Noch einmal versuchen
          </button>
          <Link href="/" className="btn">
            Zurück zu den Kandidaten
          </Link>
        </div>
        {error.digest ? (
          <p className="small muted mono" style={{ marginTop: 12 }}>
            Kennzeichen des Fehlers: {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
