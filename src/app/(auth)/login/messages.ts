/**
 * Die Fehlermeldungen der Anmeldeseite — festverdrahtet, angesprochen über ein
 * Kürzel in der Adresse.
 *
 * Freien Text aus der Adresse anzuzeigen hieße: wer einen Link verschicken
 * kann, kann jedem auf der Anmeldeseite eine Meldung unterschieben, die
 * aussieht, als käme sie von uns. Auf genau der Seite, auf der gleich ein
 * Passwort eingetippt wird, ist das die schlechteste Stelle dafür.
 *
 * Nebenbei ist damit auch das Umlautproblem weg: `?error=Ungültige` stand als
 * „UngÃ¼ltige" auf dem Bildschirm, weil der Text unkodiert in der Adresse
 * landete.
 */
export const LOGIN_ERRORS: Record<string, string> = {
  'falsche-daten': 'Ungültige Zugangsdaten.',
  'nur-google': 'Dieses Konto meldet sich über Google an.',
  'google-abgebrochen': 'Anmeldung bei Google abgebrochen.',
  'google-abgelaufen': 'Anmeldung abgelaufen oder ungültig. Bitte noch einmal versuchen.',
  'google-fehlgeschlagen': 'Anmeldung über Google fehlgeschlagen. Bitte noch einmal versuchen.',
  'konto-deaktiviert': 'Dieses Konto ist deaktiviert. Bitte an einen Admin wenden.',
  'kein-konto': 'Für diese Adresse gibt es hier kein Konto. Bitte von einem Admin anlegen lassen.',
};
