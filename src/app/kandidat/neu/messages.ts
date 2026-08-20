/**
 * Was beim Anlegen schiefgehen kann, in Worten statt in einer Prüfziffer.
 *
 * Bricht eine Server-Aktion mit einer Ausnahme ab, zeigt Next.js einen leeren
 * Bildschirm mit „Application error" und einer Digest-Nummer. Für den, der
 * gerade einen Fall anlegen wollte, ist das kein Fehler, sondern ein Rätsel:
 * die Seite ist weg, die Eingaben sind weg, und nichts sagt, ob es an ihm lag.
 *
 * Feste Kürzel, keine freien Texte: die Meldung kommt aus der Adresszeile, und
 * was von dort kommt, kann jeder in einen Link schreiben.
 *
 * Eigene Datei, weil `actions.ts` mit `'use server'` beginnt und aus so einer
 * Datei nur asynchrone Funktionen herausgereicht werden dürfen.
 */
export const ANLEGEN_FEHLER: Record<string, string> = {
  'kennung-doppelt':
    'Diese Kennung ist schon vergeben. Bitte noch einmal anlegen — die nächste freie steht bereits im Feld.',
  unvollstaendig: 'Es fehlt eine Angabe: Name und Arbeitsort müssen ausgefüllt sein.',
  unbekannt: 'Der Fall konnte nicht angelegt werden. Der Grund steht im Server-Protokoll.',
};
