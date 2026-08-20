/**
 * „Seite nicht gefunden" auf Deutsch, mit einem Weg zurück.
 *
 * Das eingebaute 404 von Next.js ist eine schwarz-weiße Zeile ohne Navigation.
 * Erreicht wird es hier vor allem über Lesezeichen auf gelöschte Fälle — und
 * dann steht jemand auf einer leeren Seite und weiß nicht, ob die App kaputt
 * ist oder der Fall weg.
 */

import Link from 'next/link';

export default function NichtGefunden() {
  return (
    <main className="container page" style={{ maxWidth: 640 }}>
      <div className="card card-pad stack">
        <h1 style={{ marginBottom: 4 }}>Diese Seite gibt es nicht</h1>
        <p>
          Der Link zeigt auf etwas, das es nicht mehr gibt — meistens ein Fall, der inzwischen gelöscht oder
          archiviert wurde.
        </p>
        <div className="row-wrap" style={{ marginTop: 8 }}>
          <Link href="/" className="btn primary">
            Zurück zu den Kandidaten
          </Link>
        </div>
      </div>
    </main>
  );
}
