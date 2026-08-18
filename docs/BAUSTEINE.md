# Bausteine — Funktionen an- und abschalten

Diese Werkbank kann inzwischen eine Menge. Nicht jedes Team braucht jedes
davon, und ein Bildschirm voller Dinge, die nie jemand benutzt, ist teurer als
ein Bildschirm ohne sie — er kostet bei jedem Hinsehen Aufmerksamkeit.

Deshalb ist alles Nicht-Zwingende ein **Baustein** mit einem Schalter:
**Einstellungen → Erweiterte Einstellungen → Funktionen der App.**

## Die zwei Regeln

**1. Ausschalten macht nie etwas kaputt.** Wer WG-Vorschläge abschaltet,
verliert den Menüpunkt und die Berechnung — nicht die Kandidatinnen, die schon
als WG-fähig markiert sind. Ein Baustein blendet aus, er löscht nicht. Wieder
anschalten stellt alles her.

**2. Was die App zu einer Wohnungssuche macht, ist kein Baustein.** Suche,
Anzeigenliste, Bewertung, Kontaktverlauf haben bewusst keinen Schalter. Alles
abschalten zu können klingt nach Freiheit und heißt in der Praxis, dass niemand
mehr weiß, was das Programm eigentlich tut.

## Was es gibt

### Suche & Anzeigen

| Baustein | Aus heißt |
| --- | --- |
| **Textprüfung** | Anzeigen bleiben stehen, bis jemand sie von Hand als vergeben markiert. Portale liefern gelöschte Anzeigen als ganz normale Seite aus — ohne die Prüfung merkt es erst, wer sie öffnet. |
| **Doppelte zusammenfassen** | Dieselbe Wohnung kann mehrfach in der Liste stehen. |
| **Suchkriterien durchspielen** | Das „was bringt mehr Treffer"-Panel verschwindet. |
| **Nur frisch inserierte** | Das Alter wird weiter angezeigt, filtert aber nichts. |

### Kontakt & Anfragen

| Baustein | Aus heißt |
| --- | --- |
| **Telefonnummer aus der Anzeige lesen** | Keine grünen Zeilen, keine Anrufen-Knöpfe. Bereits gefundene Nummern bleiben gespeichert. |
| **Anfragen aus der App versenden** | Zurück zu „kopieren, Portal öffnen, bestätigen". |
| **Wiedervorlagen** | Keine automatischen „Antwort prüfen"-Aufgaben mehr. |

### Planung & Priorität

| Baustein | Aus heißt |
| --- | --- |
| **WG-Vorschläge** | Menüpunkt weg. Die Zustimmung am Kandidaten bleibt. |
| **Überbrückung berechnen** | Wohnungen mit späterem Einzug ohne Kostenhinweis. |
| **Zeitleiste** | Die Linie auf der Fallübersicht verschwindet. |
| **Termine** | Der Reiter verschwindet. Bestehende Termine bleiben. |

### Benachrichtigungen

| Baustein | Aus heißt |
| --- | --- |
| **Telegram** | Keine Push-Nachrichten. Alles steht weiter unter „Aufgaben". |
| **Wochenübersicht** | Keine wöchentliche Zusammenfassung. |

### Auswertung

| Baustein | Aus heißt |
| --- | --- |
| **Antwortquote** | Die Auswertung verschwindet. Gezählt wird weiter, nur nicht gezeigt. |
| **Warnung bei Fällen ohne Treffer** | Kein Hinweis mehr. Auffallen muss es dann jemandem beim Durchsehen. |

## Die zwei neuen Auswertungen

Beide beantworten Fragen, die sonst niemand stellt, bis es zu spät ist.

### Fälle ohne passende Wohnung

Steht auf **Aufgaben & Posteingang**. Meldet Fälle, für die seit über einer
Woche nichts Anschreibbares mehr dazugekommen ist.

Nicht gemeint ist „hat keine Treffer" — ein Fall mit 200 Anzeigen, von denen
keine passt, sieht auf jeder Liste beschäftigt aus und ist es nicht. Gemeint
ist: es kommt nichts nach. Das liegt fast immer am zu engen Suchprofil und
fast nie am leeren Markt.

Ein Fall mit offenen anschreibbaren Wohnungen wird **nicht** gemeldet — dort
liegt Arbeit, sie ist nur nicht getan. Das ist Rückstand, kein Stillstand.
Drückt zusätzlich die Anreise, wird die Meldung als **dringend** markiert.

### Antwortquote

Ebenfalls auf **Aufgaben & Posteingang**. Zählt je Quelle und insgesamt, wie
viele Anfragen beantwortet werden.

Zwei bewusste Entscheidungen:

- **Auch eine Absage zählt als Antwort.** Gemessen wird, ob überhaupt jemand
  reagiert — nicht, ob es gut ausging.
- **Unter fünf Anfragen gibt es keine Quote.** Aus zwei Anfragen sind 0 % oder
  50 %, und beides heißt nichts. Lieber „zu wenige" als eine Zahl, nach der
  jemand eine funktionierende Quelle abschaltet.

Anfragen der letzten drei Tage zählen nicht mit, sonst drückt jede heute
verschickte Anfrage die Quote und die Zahl sagt mehr über den Vormittag als
über das Anschreiben.

## Einen neuen Baustein bauen

1. Eintrag in `src/domain/features/index.ts` ergänzen — Schlüssel, Text,
   Gruppe, `defaultOn`, und **was das Ausschalten kostet**. Der letzte Satz ist
   Pflicht: ein Schalter, der nicht sagt, was danach fehlt, wird nicht
   umgelegt.
2. `defaultOn` bewusst wählen. Neue Bausteine starten aus, außer sie ersetzen
   etwas, das vorher immer da war — sonst ändert ein Deploy für alle
   stillschweigend die Oberfläche.
3. Dort abfragen, wo die Funktion sichtbar wird:

   ```ts
   import { featureOn } from '@/server/settings';
   if (await featureOn('meinBaustein')) { … }
   ```

   In einer Server Component, die ohnehin Einstellungen lädt, lieber einmal
   `getFeatureSettings()` und dann `isFeatureOn(features, 'meinBaustein')` —
   das spart Abfragen.
4. Einen Test dazu, der prüft, dass das Ausschalten *etwas bewirkt*. Ein
   Schalter, der nur ein Kästchen umlegt, ist schlimmer als kein Schalter:
   er verspricht eine Wirkung, die es nicht gibt. Vorbild:
   `tests/features.test.ts`.

Der Schalter erscheint danach von selbst in seiner Gruppe — es gibt keine
zweite Liste zu pflegen.
