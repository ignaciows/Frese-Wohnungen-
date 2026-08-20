'use client';

/**
 * Derselbe Bildschirm, eine Ebene höher.
 *
 * `error.tsx` fängt alles unterhalb des Grundgerüsts. Bricht das Grundgerüst
 * selbst ab, greift nur diese Datei — und sie muss `html` und `body` selbst
 * mitbringen, weil in dem Fall keins davon steht. Ohne sie ist der Bildschirm
 * wieder weiß.
 */

export default function GrundgeruestFehler({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="de">
      <body
        style={{
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: 32,
          maxWidth: 640,
          margin: '0 auto',
          color: '#0f2429',
          background: '#f4f7f8',
        }}
      >
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Da ist etwas schiefgegangen</h1>
        <p style={{ fontSize: 18, lineHeight: 1.5 }}>
          Die App konnte diese Seite nicht aufbauen. Gespeichert wurde nichts, was nicht vollständig
          durchgelaufen ist.
        </p>
        <p style={{ marginTop: 20 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              fontSize: 17,
              padding: '12px 22px',
              borderRadius: 10,
              border: 'none',
              background: '#0f7a5b',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Noch einmal versuchen
          </button>
        </p>
        {error.digest ? (
          <p style={{ fontSize: 14, color: '#5b6b70', marginTop: 16 }}>
            Kennzeichen des Fehlers: {error.digest}
          </p>
        ) : null}
      </body>
    </html>
  );
}
