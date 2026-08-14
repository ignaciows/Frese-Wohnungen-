# Die Zeitleiste

Ein Fall ist ein Wettlauf zwischen zwei Terminen: dem Tag, an dem die Person
landet, und dem Tag, an dem irgendeine Wohnung tatsächlich frei ist. Alles
andere auf dem Kandidatenbildschirm — Zählerstände, Reiter, Abzeichen —
beschreibt die Arbeit, nicht den Wettlauf. Die Zeitleiste beschreibt den
Wettlauf.

Der Code liegt in zwei Hälften:

* `src/domain/timeline/index.ts` — reine Datumsarithmetik, kein React, keine
  Datenbank, `now` wird hineingereicht. Vollständig getestet in
  `tests/timeline.test.ts`.
* `src/app/_components/Timeline.tsx` — zeichnet nur, entscheidet nichts.

Gelesen wird von oben nach unten: der Satz sagt, wie viel Zeit bleibt; die
Achse sagt, wo heute zwischen Vertrag und Ankunft liegt; jede Zeile darunter
ist eine Wohnung.

## Zwei Maßstäbe auf der Achse

Die Achse trägt Monate **und** Wochen. Der Grund ist, dass in Monaten niemand
arbeitet: die Anfrage geht diese Woche raus, die Besichtigung ist nächste
Woche, frei wird die Wohnung in der Woche darauf. Ein Vermieter am Telefon sagt
„ab KW 38".

* **Monate** — die groben Beschriftungen oben.
* **Wochen** — ein Strich auf jedem Montag, darüber sein Datum. Die laufende
  Woche ist in der Markenfarbe hervorgehoben; die Montage, die einen Monat
  eröffnen, bekommen einen längeren Strich. Der Titel jedes Strichs nennt die
  Kalenderwoche.

Die Striche werden ausgedünnt, sobald es zu viele werden: bis 26 Wochen jeder
Montag, bis 52 jeder zweite, darüber jeder vierte. Nicht der Strich wird eng,
sondern die Beschriftung darunter.

Kalenderwochen werden nach ISO 8601 gezählt (`isoWeek()`): Woche 1 ist die
Woche mit dem ersten Donnerstag des Jahres. Deshalb gehört der 1.1.2027, ein
Freitag, noch in die KW 53 des Vorjahres — genau wie auf einem deutschen
Wandkalender.

## Die Gefahrenzone

Eine Wohnung muss gefunden, angeschrieben, besichtigt und unterschrieben
werden. Sechs Wochen sind bequem, drei sind knapp, und innerhalb von drei
Wochen ohne Zusage zahlt jemand demnächst ein Hotel.

| Rest bis zur Ankunft | Stufe | Was man sieht |
| --- | --- | --- |
| über 45 Tage | `CALM` | nichts Besonderes |
| 45 bis 21 Tage | `WATCH` | „◔ Wird eng" |
| unter 21 Tagen | `DANGER` | „⚠ Kritisch", rotes Band hinter den Zeilen |

Ist die Wohnung gesichert, ist die Stufe immer `CALM` — dann läuft die Uhr
nicht mehr.

Das Band wird **hinter** den Zeilen gezeichnet. Jeder Balken, der darin endet,
ist damit sichtbar zu spät, ohne dass eine Zahl gelesen werden muss.

## „Frei ab" von Hand eintragen

Die meisten Anzeigen nennen kein Einzugsdatum. Ohne dieses Datum lässt sich die
Wohnung nicht gegen die Ankunft stellen: sie steht auf der Linie mit „Kein
Datum in der Anzeige" und bekommt beim Timing nichts.

Die Kollegin, die gerade mit dem Vermieter telefoniert hat, kennt das Datum
aber. Deshalb trägt jede Zeile der Zeitleiste — und die Detailspalte der
Ergebnisliste — einen kleinen Schalter „＋ Frei ab eintragen".

Was beim Speichern passiert (`setListingAvailableFromAction`):

1. `Listing.availableFrom` wird gesetzt (auf 12:00 Uhr, nicht Mitternacht —
   sonst rutscht das Datum je nach Zeitzone auf den Vortag).
2. Eine `ListingFact`-Zeile mit `isOverride = true` wird angelegt. Das ist der
   Mechanismus, den der Import bereits respektiert: beim nächsten Durchlauf
   über dieselbe Anzeige wird das Feld **nicht** überschrieben. Die Anzeige
   sagt weiterhin nichts, und nichts darf etwas nicht überschreiben.
3. Die Übereinstimmung wird für alle Kandidaten neu gerechnet, weil das Datum
   ein Fünftel der Punktzahl ausmacht.

Ein leeres Feld löscht den Eintrag wieder.
