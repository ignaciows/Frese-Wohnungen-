# Oberfläche — die Regeln

Diese App wird von Leuten benutzt, die nicht dafür ausgebildet sind und sie
nicht jeden Tag öffnen. Zwei Personen haben sie gesehen und gesagt, sie werden
davon wirr. Das ist kein Geschmacksurteil, das ist ein Befund.

Was hier steht, ist keine Stilfrage. Es sind die Regeln, nach denen jeder
Bildschirm dieser App gebaut wird, mit dem Grund dahinter — damit man sie
anwenden kann, statt sie auswendig zu lernen, und damit man weiß, wann man eine
brechen darf.

---

## Teil 1 — Wie Menschen einen Bildschirm lesen

### 1.1 Aufmerksamkeit ist ein Betrag, kein Zustand

Wer einen Bildschirm öffnet, hat eine begrenzte Menge Aufmerksamkeit und gibt
sie aus, bevor er etwas tut. Jedes Element kostet davon — auch das, was man
überliest, denn überlesen heißt: angesehen, eingeordnet, verworfen.

Daraus folgt die härteste Regel dieses Dokuments:

> **Ein Element, das nie etwas anderes sagt, sagt nichts.**

„Noch nicht geprüft" auf jeder Zeile, „Entfernung unbekannt" auf jeder Zeile,
„Kein Einstelldatum" auf jeder Zeile — das ist keine Information, das ist eine
Gebühr. Was auf fast allen Zeilen steht, gehört einmal unter die Liste, nicht
zwanzigmal hinein.

Gegenprobe vor jedem neuen Element: **Wann steht hier etwas anderes?** Wenn die
Antwort „nie" oder „fast nie" ist, gehört es nicht in die Zeile.

### 1.2 Erkennen ist billiger als Erinnern

Wer eine Liste durchgeht, erkennt Formen und Farben, bevor er Wörter liest.
Deshalb:

- Zustand über **Form und Farbe**, nicht nur über Text. Eine Anzeige mit
  Telefonnummer trägt einen grünen Rand und einen grünen Knopf — man sieht sie,
  ohne zu lesen.
- **Dieselbe Sache, dasselbe Aussehen, überall.** Grün heißt in dieser App
  immer „hier kann man heute anrufen". Nirgends sonst.
- Nie Farbe **allein**: jede Farbe hat ein Wort daneben. Ein Achtel der Männer
  sieht Rot und Grün nicht auseinander, und niemand sagt es einem.

### 1.3 Der Blick springt nicht, er fällt

Auf einem Bildschirm in dieser Sprache geht der Blick von links oben nach
rechts unten, und er bleibt an dem hängen, was am meisten heraussticht. Genau
ein Element pro Bildschirm darf am meisten herausstechen: das, was als nächstes
zu tun ist.

Zwei gleich große, gleich farbige Knöpfe nebeneinander sind eine Frage, keine
Anweisung — und eine Frage kostet Zeit.

### 1.4 Sieben Dinge sind zu viele

Eine Reihe mit neun Reitern wird nicht gelesen, sie wird abgesucht. Ab etwa
fünf gleichrangigen Möglichkeiten fängt man an zu suchen statt zu wählen.

Der Ausweg ist **nicht** löschen, sondern **rangieren**: zwei bis drei groß,
der Rest klein darunter oder zugeklappt. Die Funktion bleibt, sie meldet sich
nur nicht mehr zu Wort.

### 1.5 Nähe schlägt Linien

Was zusammengehört, steht zusammen — mit Abstand ringsum. Ein Kasten um jede
Kleinigkeit ist Lärm; ein Abstand ist unsichtbar und wirkt genauso.

Faustregel: der Abstand **innerhalb** einer Gruppe muss deutlich kleiner sein
als der Abstand **zwischen** zwei Gruppen. Sind sie gleich, sieht man keine
Gruppen mehr, egal wie viele Linien man zieht.

---

## Teil 2 — Was der Bildschirm dem Menschen schuldet

### 2.1 Jede Handlung bekommt eine Antwort, sofort

Wer klickt, muss innerhalb von **100 Millisekunden** sehen, dass der Klick
angekommen ist — sonst klickt er noch einmal. Das ist keine Ungeduld, das ist
Reflex.

- Unter 100 ms: fühlt sich sofort an. Nichts weiter nötig.
- Bis 1 Sekunde: der Gedanke reißt nicht ab. Der Knopf muss trotzdem *sofort*
  sichtbar reagieren (gedrückt, ausgegraut, Spinner).
- Über 1 Sekunde: es braucht etwas, das sich bewegt, sonst wirkt es kaputt.
- Über 10 Sekunden: es braucht einen Fortschritt in Zahlen und die Erlaubnis,
  wegzugehen.

### 2.2 Der Bildschirm sagt immer, was gerade ist

Nach jeder Handlung: hat es geklappt, und was ist jetzt anders. Eine Änderung,
die stillschweigend passiert, wird nicht geglaubt und noch einmal gemacht.

### 2.3 Bewegung erklärt, sie schmückt nicht

Eine Animation ist dazu da, eine Frage zu beantworten: *Wo kommt das her? Wo
ist es hin? Was hat sich geändert?* Alles andere kostet Zeit.

- 150–200 ms für Farbe, Rand, Schatten (Hover, Fokus, gedrückt).
- 200–300 ms für Auftauchen und Verschwinden.
- Beschleunigen beim Verschwinden, abbremsen beim Auftauchen.
- Nie länger als 400 ms. Was länger dauert, wird beim zweiten Mal als
  Verzögerung empfunden.
- **`prefers-reduced-motion` wird immer beachtet.** Die Farbe bleibt, die
  Bewegung geht. Für manche Menschen ist Bewegung auf dem Bildschirm nicht
  Geschmack, sondern Übelkeit.

### 2.4 Fehler sind Wegweiser, keine Urteile

Ein Fehler nennt drei Dinge: **was** nicht ging, **warum**, und **was jetzt**.
„Ungültige Eingabe" nennt keins davon.

Und er steht **dort, wo das Problem ist** — nicht oben, wenn das Feld unten
steht, und nie in einem zugeklappten Abschnitt.

### 2.5 Leer ist ein Zustand, kein Unfall

Ein leerer Bildschirm ist die erste Begegnung mit einer Funktion. Er sagt, was
hier normalerweise steht, warum gerade nichts da ist, und wie man das ändert —
mit einem Knopf, der genau dorthin führt.

Und er unterscheidet die Fälle: *noch nichts da* ist etwas anderes als *alles
erledigt* und wieder etwas anderes als *es passt nur nichts*. Drei Zustände,
drei Sätze, drei verschiedene nächste Schritte.

### 2.6 Zahlen versprechen Arbeit

Ein Abzeichen mit einer Zahl ist ein Versprechen: *hier liegt so viel für
dich*. Es muss **genau das** zählen, was darunter zu finden ist.

Das ist keine Kleinigkeit. Diese App hat einmal „350 Anzeigen zu kontaktieren"
über einer Kachel „0 Passende Anzeigen" angezeigt — auf demselben Bildschirm.
Wer der 350 folgte, landete auf einer leeren Liste. Danach glaubt man keiner
Zahl mehr, auch keiner richtigen.

Und: eine Zahl, auf die niemand handeln kann, gehört weg. „428 abgelaufen" ist
keine Auskunft.

### 2.7 Alles ist mit der Tastatur erreichbar

Alles Klickbare ist ein `<button>` oder ein `<a>`, kein `div` mit Klick. Der
Fokus ist sichtbar — deutlich sichtbar, nicht ein blasser Ring. Die Reihenfolge
folgt dem Bild.

Das ist nicht nur für Menschen mit Behinderung: wer den ganzen Tag Anfragen
tippt, arbeitet mit der Tastatur.

---

## Teil 3 — Wie es hier konkret aussieht

### 3.1 Knöpfe

Ein Knopf ist so groß wie wichtig.

| Rolle | Aussehen | Wie viele pro Bildschirm |
| --- | --- | --- |
| Die Handlung | gefüllt, Akzentfarbe, groß | **genau eine** |
| Daneben | Umriss | zwei bis drei |
| Nebensache | nur Text, gedämpft | beliebig |
| Gefährlich | rot, abgesetzt, mit Hürde davor | so wenige wie möglich |

Mindestens **44 × 44 Pixel** Trefferfläche — das ist die Größe einer
Fingerkuppe, und die ändert sich nicht dadurch, dass jemand eine Maus benutzt.

Die Beschriftung ist ein **Verb**: „Anrufen", „Anfrage senden", „Fall löschen".
Nicht „OK", nicht „Absenden", nicht „Weiter".

### 3.2 Schrift

Drei Größen reichen für fast alles: Überschrift, Fließtext, Kleingedrucktes.
Wer eine vierte braucht, hat meistens ein Ordnungsproblem und kein Schriftgröße-
Problem.

Fließtext nicht unter 14 px. Zeilen nicht länger als etwa 75 Zeichen.

### 3.3 Farbe

Vier Bedeutungen, mehr nicht:

- **Akzent** — hier klicken.
- **Grün** — hier kann man heute anrufen.
- **Gelb** — daran ist etwas, aber es geht weiter.
- **Rot** — hier hört etwas auf, oder jemand muss etwas tun.

Grau ist keine Bedeutung, sondern Abwesenheit. Alles Übrige ist Text auf
Hintergrund.

Beides prüfen: hell **und** dunkel. Ein Kontrast von 4,5:1 für Text, 3:1 für
Ränder und Symbole.

### 3.4 Ein Bildschirm ist so gebaut

1. **Wo bin ich** — Titel, Brotkrumen.
2. **Was ist los** — der eine Satz, der den Zustand beschreibt.
3. **Was tue ich** — der eine große Knopf.
4. **Die Arbeit** — Liste, Formular, Tabelle.
5. **Das Übrige** — klein, zugeklappt, unten.

Wenn Punkt 3 nicht zu benennen ist, ist der Bildschirm noch nicht fertig
gedacht.

### 3.5 Listen

- Höchstens **zehn** auf einmal, das Beste oben, „weitere anzeigen" darunter.
- Jede Zeile ist ganz anklickbar, nicht nur ein Wort darin.
- Drei Angaben pro Zeile reichen: was, wie viel, wo.
- Abzeichen: höchstens zwei je Zeile. Was auf fast allen Zeilen steht, wandert
  unter die Liste (siehe 1.1).

### 3.6 Wörter

Geschrieben wird, was jemand **laut sagen** würde.

| Nicht | Sondern |
| --- | --- |
| Kompatibilität | passt / passt fast / passt nicht |
| Liveness-Prüfung | ist die Anzeige noch online |
| Baustein | Funktion |
| Wiedervorlage | Antwort prüfen |
| Kerndaten | Angaben |
| Suchkriterien durchspielen | Was bringt mehr Treffer? |

Abkürzungen nur, wenn sie auf dem Papier stehen, das jemand in der Hand hält.

---

## Teil 4 — Die Prüfliste

Für jeden Bildschirm, der neu ist oder angefasst wurde:

- [ ] Der eine nächste Schritt ist benennbar und sichtbar der größte Knopf.
- [ ] Jede Zahl zählt genau das, was darunter zu finden ist.
- [ ] Kein Element steht auf fast jeder Zeile.
- [ ] Höchstens fünf gleichrangige Möglichkeiten; der Rest ist klein oder
      zugeklappt.
- [ ] Jeder Klick antwortet innerhalb von 100 ms sichtbar.
- [ ] Der leere Zustand sagt, warum leer und was jetzt.
- [ ] Fehler stehen an der Stelle, an der sie entstanden sind, und nennen den
      nächsten Schritt.
- [ ] Alles Klickbare ist mit der Tastatur erreichbar und hat sichtbaren Fokus.
- [ ] Hell und dunkel angesehen.
- [ ] `prefers-reduced-motion` ausprobiert.
- [ ] Auf 375 px Breite angesehen.
- [ ] Kein Wort, das man nicht laut sagen würde.

---

## Teil 5 — Der Stand

Was schon so ist, was noch nicht. Wird beim Durchgehen fortgeschrieben.

**Quer durch alle Bildschirme erledigt:** jeder der 60 Absende-Knöpfe zeigt
jetzt während der Server-Aktion einen Kreisel, sperrt sich gegen den zweiten
Klick und meldet `aria-busy` (Regel 2.1). An einer künstlich gebremsten
Anmeldung nachgesehen.

| Bildschirm | Stand | Was noch fehlt |
| --- | --- | --- |
| Aufgaben & Posteingang | gut | — |
| Ergebnisliste | gut | Punktzahl 82/73 erklärt sich nicht |
| Fallübersicht | mittel | zwei Navigationsreihen, neun Ziele |
| Kandidatenliste | mittel | noch nicht durchgegangen |
| Einstellungen | schwach | eine Wand aus Karten |
| Quellen | mittel | noch nicht durchgegangen |
| WG-Vorschläge | offen | noch nicht durchgegangen |
| Anmeldung | gut | — |
