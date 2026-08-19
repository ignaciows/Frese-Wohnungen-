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

/**
 * Ein Durchgang: suchen, Kontaktdaten nachziehen, Postfach lesen.
 *
 * Exportiert, damit prüfbar ist, was hier am meisten wehtut — dass ein
 * Schritt, der nichts zu tun hat, die folgenden nicht mitnimmt.
 */
export async function runTick(): Promise<void> {
  try {
    const { maybeRunDiscoverySweep } = await import('@/server/discovery');
    const summary = await maybeRunDiscoverySweep();
    // Ein übersprungener Suchlauf ist kein Fehler — meistens „zuletzt vor
    // Kurzem gesucht" oder „keine Quelle eingeschaltet". Absichtlich leise,
    // sonst steht im Protokoll alle zwanzig Minuten dasselbe.
    //
    // Und ausdrücklich **kein** `return`: hier stand einmal eins, und weil in
    // der Produktion keine Quelle eingeschaltet war, wurde jeder Takt beim
    // ersten Schritt abgebrochen. Postfach und Nachlauf liefen dadurch nie —
    // nachgesehen im Protokoll, wo nach dem Start acht Minuten lang gar nichts
    // mehr kam. Jeder Schritt hier steht für sich.
    if (!summary.skippedReason) {
      console.log(
        `[takt] Suchlauf: ${summary.created} neu, ${summary.updated} bestätigt, ` +
          `${summary.retired} entfernt, ${summary.notified} Meldung(en).`,
      );
    }
  } catch (err) {
    console.warn(`[takt] Suchlauf fehlgeschlagen: ${(err as Error).message}`);
  }

  // Bestand nachziehen: Anzeigen, die vor der Telefonnummer-Erkennung
  // importiert wurden, kommen hier einmal dran. Kostet keinen Portalaufruf —
  // der Text liegt schon in der Datenbank — und ist von selbst zu Ende, sobald
  // jede Anzeige einmal durchsucht wurde.
  try {
    const { backfillContacts } = await import('@/server/contactBackfill');
    const r = await backfillContacts();
    if (r.scanned > 0) {
      console.log(
        `[takt] Kontaktdaten nachgelesen: ${r.scanned} Anzeigen, ${r.phonesFound} Nummer(n) gefunden, ${r.remaining} offen.`,
      );
    }
  } catch (err) {
    console.warn(`[takt] Kontaktdaten nachlesen fehlgeschlagen: ${(err as Error).message}`);
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
}

export async function register(): Promise<void> {
  // Nur im Node-Prozess. Next lädt diese Datei auch für die Edge-Runtime, und
  // dort gibt es weder Prisma noch einen langlebigen Prozess.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.AUTO_SWEEP === 'off') {
    console.log('[takt] AUTO_SWEEP=off — kein automatischer Suchlauf in diesem Prozess.');
    return;
  }

  setTimeout(() => {
    void runTick();
    // `unref` gibt es hier bewusst nicht: dieser Wecker *ist* der Grund, warum
    // der Prozess auch ohne Besucher etwas tut.
    setInterval(() => void runTick(), TICK_MINUTES * 60_000);
  }, FIRST_TICK_SECONDS * 1000);

  console.log(`[takt] Automatischer Suchlauf alle ${TICK_MINUTES} Minuten.`);
}
