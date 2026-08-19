/**
 * Der Taktgeber: Suche und Postfach laufen auch, wenn niemand die App öffnet.
 *
 * Vorher gab es zwei Wege, und beide setzten jemanden voraus:
 *
 *  - Der Suchlauf startete, wenn ein Mensch eine Seite aufmachte.
 *  - `/api/discovery/run` konnte von außen aufgerufen werden — nur rief es
 *    niemand, weil dafür ein Cron eingerichtet sein muss und keiner war.
 *
 * Ergebnis: am Wochenende und über Nacht passierte nichts. Genau dann
 * erscheinen und verschwinden die guten Wohnungen.
 *
 * Deshalb hier ein Wecker im Serverprozess selbst. Kein zusätzlicher Dienst,
 * keine Plattform-Einstellung, nichts, was jemand vergessen kann.
 *
 * Drei Dinge, die das erträglich machen:
 *
 *  1. **Der Wecker entscheidet nicht, ob gesucht wird.** Er klopft nur an;
 *     `maybeRunDiscoverySweep` prüft selbst die Einstellungen und den Abstand
 *     zum letzten Lauf. Zweimal Klopfen kostet deshalb nichts, und ein zweiter
 *     Serverprozess (Neustart, zweite Instanz) führt nicht zu zwei Suchläufen.
 *  2. **Fehler bleiben hier.** Ein Suchlauf, der scheitert, darf den Server
 *     nicht mitnehmen — er wird protokolliert und beim nächsten Takt neu
 *     versucht.
 *  3. **Abschaltbar.** `AUTO_SWEEP=off` in der Umgebung, und der Wecker
 *     existiert nicht. Für lokale Entwicklung, wo niemand alle zwanzig Minuten
 *     echte Portale abrufen will.
 *
 * Wer lieber einen echten Cron betreibt, kann das weiterhin: die Endpunkte
 * `/api/discovery/run` und `/api/ingest/email` bleiben, wie sie sind, und der
 * Wecker stört sie nicht.
 */

/** Wie oft angeklopft wird. Der Abstand zwischen echten Läufen steht in den Einstellungen. */
const TICK_MINUTES = 20;

/** Beim Start einmal warten, bis die Datenbank sicher erreichbar ist. */
const FIRST_TICK_SECONDS = 90;

export async function register(): Promise<void> {
  // Nur im Node-Prozess. Next lädt diese Datei auch für die Edge-Runtime, und
  // dort gibt es weder Prisma noch einen langlebigen Prozess.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.AUTO_SWEEP === 'off') {
    console.log('[takt] AUTO_SWEEP=off — kein automatischer Suchlauf in diesem Prozess.');
    return;
  }

  const tick = async () => {
    // Import erst hier: beim Modulladen ist die Datenbankverbindung noch nicht
    // eingerichtet, und ein Fehlschlag würde den Serverstart mitnehmen.
    try {
      const { maybeRunDiscoverySweep } = await import('@/server/discovery');
      const summary = await maybeRunDiscoverySweep();
      if (summary.skippedReason) {
        // Kein Fehler — meistens „zuletzt vor Kurzem gesucht". Absichtlich
        // leise, sonst steht im Protokoll alle zwanzig Minuten dasselbe.
        return;
      }
      console.log(
        `[takt] Suchlauf: ${summary.created} neu, ${summary.updated} bestätigt, ` +
          `${summary.retired} entfernt, ${summary.notified} Meldung(en).`,
      );
    } catch (err) {
      console.warn(`[takt] Suchlauf fehlgeschlagen: ${(err as Error).message}`);
    }

    try {
      const { ingestAllMailboxes } = await import('@/server/mailIngest');
      const result = await ingestAllMailboxes();
      if (result.processed > 0) {
        console.log(`[takt] Postfach: ${result.processed} Mail(s) verarbeitet.`);
      }
    } catch (err) {
      console.warn(`[takt] Postfach lesen fehlgeschlagen: ${(err as Error).message}`);
    }
  };

  setTimeout(() => {
    void tick();
    // `unref` gibt es hier bewusst nicht: dieser Wecker *ist* der Grund, warum
    // der Prozess auch ohne Besucher etwas tut.
    setInterval(() => void tick(), TICK_MINUTES * 60_000);
  }, FIRST_TICK_SECONDS * 1000);

  console.log(`[takt] Automatischer Suchlauf alle ${TICK_MINUTES} Minuten.`);
}
