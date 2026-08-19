# Bausteine — Funktionen an- und abschalten

Diese Werkbank kann inzwischen eine Menge. Nicht jedes Team braucht jedes
davon, und ein Bildschirm voller Dinge, die nie jemand benutzt, ist teurer als
ein Bildschirm ohne sie — er kostet bei jedem Hinsehen Aufmerksamkeit.

Deshalb ist alles Nicht-Zwingende ein **Baustein** mit einem Schalter:
**Einstellungen → Erweiterte Einstellungen → Funktionen der App.**

## Die drei Regeln

**1. Ausschalten macht nie etwas kaputt.** Wer WG-Vorschläge abschaltet,
verliert den Menüpunkt und die Berechnung — nicht die Kandidatinnen, die schon
als WG-fähig markiert sind. Ein Baustein blendet aus, er löscht nicht. Wieder
anschalten stellt alles her.

**2. Was die App zu einer Wohnungssuche macht, ist kein Baustein.** Suche,
Anzeigenliste, Bewertung, Kontaktverlauf haben bewusst keinen Schalter. Alles
abschalten zu können klingt nach Freiheit und heißt in der Praxis, dass niemand
mehr weiß, was das Programm eigentlich tut.

**3. Kein zweiter Schalter für dieselbe Sache.** Versand, Telegram,
Textprüfung, Altersfilter und Wiedervorlagen haben in ihrer eigenen
Einstellungskarte schon ein „an/aus" und stehen deshalb nicht in dieser Liste.
Zwei Schalter für eine Funktion sind schlimmer als keiner: dann sucht jemand
den, der gerade nicht wirkt.

## Was es gibt

### Suche & Anzeigen

| Baustein | Aus heißt |
| --- | --- |
| **Doppelte Anzeigen zusammenfassen** | Dieselbe Wohnung kann mehrfach in der Liste stehen. Schon gebildete Gruppen bleiben. |
| **Suchkriterien durchspielen** | Das „was bringt mehr Treffer"-Panel verschwindet. |

### Kontakt & Anfragen

| Baustein | Aus heißt |
| --- | --- |
| **Telefonnummer aus der Anzeige lesen** | Keine grünen Zeilen, keine Anrufen-Knöpfe. Bereits gefundene Nummern bleiben gespeichert. |

### Planung & Priorität

| Baustein | Aus heißt |
| --- | --- |
| **Tagesliste „Heute dran"** | Die Reihenfolge muss sich wieder jeder selbst aus der Kandidatenliste ableiten. |
| **WG-Vorschläge** | Menüpunkt weg. Die Zustimmung am Kandidaten bleibt. |
| **Überbrückung berechnen** | Die Lücke zwischen Ankunft und Einzug steht weiter da, nur ohne Preisschild. |
| **Zeitleiste** | Die Linie auf der Fallübersicht verschwindet. |
| **Termine** | Der Reiter verschwindet — auch über die Adresse direkt. Bestehende Termine bleiben. |

### Auswertung

| Baustein | Aus heißt |
| --- | --- |
| **Antwortquote** | Die Auswertung verschwindet. Gezählt wird weiter, nur nicht gezeigt. |
| **Warnung bei Fällen ohne Treffer** | Kein Hinweis mehr. Auffallen muss es dann jemandem beim Durchsehen. |

## Die Tagesliste

Steht ganz oben auf **Aufgaben & Posteingang** und beantwortet die Frage, mit
der ein Arbeitstag anfängt: **womit fange ich an?**

Drei Blöcke in genau einer Reihenfolge:

1. **Zuerst anrufen** — Fälle, für die eine passende Anzeige selbst eine
   Telefonnummer nennt.
2. **Dann anschreiben** — der Rest mit offenen Wohnungen, nach Dringlichkeit.
3. **Ohne offene Wohnung** — zugeklappt. Dort ist heute nichts zu holen; das
   ist derselbe Befund wie die Stillstands-Warnung weiter unten.

Die eine Regel, die das von der Kandidatenliste unterscheidet: **eine
Telefonnummer schlägt jeden Punktestand.** Wer anruft, hat in zehn Minuten
eine Antwort; wer schreibt, hat sie am Donnerstag oder nie. Das ist keine
dringendere Aufgabe derselben Art, sondern eine andere Art von Aufgabe.

Innerhalb eines Blocks zählt wieder die normale Dringlichkeit aus
`domain/priority`: Anreisedatum, Wartezeit seit Vertragsunterschrift,
Schwierigkeit des Zielmarkts, Rückstand an Anfragen. Bei Gleichstand
entscheidet der Name, damit die Reihenfolge zwischen zwei Aufrufen stehen
bleibt und niemand sucht, wohin ein Fall gesprungen ist.

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

Gezählt wird ab dem Tag, an dem ein Treffer zum Fall kam (`matchedAt`), nicht
ab der letzten Neuberechnung — sonst hätte ein Klick auf „Suchprofil
speichern" jeden Fall wieder auf null gestellt. Und eine inzwischen
abgelaufene Anzeige zählt weiter mit: sie beweist, dass die Suche einmal etwas
hergab. Ohne das meldete sich ein Fall, für den es wochenlang lief, irgendwann
als „noch nie ein Treffer".

### Antwortquote

Ebenfalls auf **Aufgaben & Posteingang**. Zählt je Quelle und insgesamt, wie
viele Anfragen beantwortet werden.

Zwei bewusste Entscheidungen:

- **Auch eine Absage zählt als Antwort.** Gemessen wird, ob überhaupt jemand
  reagiert — nicht, ob es gut ausging.
- **Unter fünf Anfragen gibt es keine Quote.** Aus zwei Anfragen sind 0 % oder
  50 %, und beides heißt nichts. Lieber „zu wenige" als eine Zahl, nach der
  jemand eine funktionierende Quelle abschaltet.

Zwei Grenzen, beide absichtlich: Anfragen der letzten drei Tage zählen nicht
mit, sonst drückt jede heute verschickte Anfrage die Quote und die Zahl sagt
mehr über den Vormittag als über das Anschreiben. Und älter als ein halbes Jahr
zählt auch nicht — ein Anschreiben, das vor einem Jahr schlecht lief, sagt
nichts über das von heute.

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

Schritt 3 ist der, den man vergisst. `tests/features.test.ts` sucht deshalb
jeden Schlüssel im Quelltext und schlägt fehl, wenn einer nirgends abgefragt
wird — das ist genau der Fehler, den diese Liste einmal hatte: fünfzehn
Schalter, neun davon ohne jede Wirkung.

Der Schalter erscheint danach von selbst in seiner Gruppe — es gibt keine
zweite Liste zu pflegen.
