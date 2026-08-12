# Die Punktzahl — warum sie so gerechnet wird

Wer diese Datei liest, soll danach jede Zahl auf der Ergebnisseite erklären
können, ohne den Code zu lesen. Der Code steht in `src/domain/ranking/index.ts`
und ist vollständig unit-getestet (`tests/ranking.test.ts`,
`tests/qualityFilter.test.ts`).

## Die Aufgabe

Für einen Kandidaten liegen einige hundert Anzeigen im Pool. Gesucht ist **eine
Reihenfolge**, die eine Kollegin von oben nach unten abarbeiten kann, bis die
Anfragen des Tages raus sind. Nicht mehr und nicht weniger: die Zahl ist ein
Sortierschlüssel mit Begründung, keine Wahrscheinlichkeit und keine Prognose.

Daraus folgen drei Anforderungen, an denen sich jede Regel messen lassen muss:

1. **Monotonie.** Wird eine Wohnung in einer Hinsicht besser und in keiner
   schlechter, muss ihre Zahl steigen. Sonst ist die Reihenfolge nicht erklärbar.
2. **Ehrlichkeit über Unwissen.** Was wir nicht wissen, darf nicht wie etwas
   Gutes aussehen. Eine Anzeige ohne Angaben ist kein Volltreffer.
3. **Nachvollziehbarkeit.** Zu jeder Zahl gehören die Sätze, aus denen sie
   entstanden ist — sie stehen als `reasons` an der Zeile.

## Drei Stufen

```
   Anzeige ──▶ [1] Ausschluss ──▶ [2] Kompatibilität ──▶ [3] Punktzahl ──▶ Liste
               (ist das mietbar?)  (passt es zum Profil?)  (wie gut?)
```

### Stufe 1 — Ausschluss: ist das überhaupt eine mietbare Wohnung?

`src/domain/discovery/plausible.ts`, Grenzen aus den Einstellungen
(`QualitySettings`). Fällt hier etwas durch, bekommt es **keine Punktzahl**; es
ist keine schlechte Wohnung, es ist keine.

| Regel | Standard | Warum |
| --- | --- | --- |
| Mindestmiete | 250 €/Monat | Darunter ist es ein Zimmer oder ein Preis pro Nacht |
| Höchstmiete | 2 500 €/Monat | Darüber vermitteln wir nicht |
| Höchstens Zimmer | 6 | Eine „Wohnung" mit 20 Zimmern ist ein Haus |
| Mindestfläche | 15 m² | Darunter ist es ein WG-Zimmer, wie auch immer betitelt |
| Wohnen auf Zeit | aus | Monteurzimmer, Boardinghouse, „pro Woche", Messewohnung |
| Kein Wohnraum | — | Gewerbe, Stellplatz, Lagerraum, Menüseiten |

Diese Regeln laufen **zweimal**: beim Import (damit nichts in den Pool kommt)
und beim Bewerten (damit sie auch für alles gelten, was schon drin liegt). Das
zweite war lange nicht so, und deshalb stand ein Gamescom-Apartment für 135 €
wochenlang auf Platz 1.

### Stufe 2 — Kompatibilität: harte Blocker

`classify()`. Ergebnis ist `COMPATIBLE`, `NEAR_MATCH`, `INSUFFICIENT_DATA` oder
`INCOMPATIBLE`. Ein Blocker heißt: schreibt niemand an, egal wie gut der Rest
ist. Etwa: Objekttyp WG-Zimmer/Haus/Gewerbe, Warmmiete über 115 % der
Obergrenze, zu wenige Zimmer, WBS nötig ohne WBS, Anbieter für Wohnen auf Zeit.

**Unbekanntes blockiert nie.** Es erzeugt ein Soft-Flag und schiebt auf
`NEAR_MATCH` — sonst würde ein fehlender Geocoder die ganze Liste sperren.

### Stufe 3 — Punktzahl: wie gut ist es?

Nur für `COMPATIBLE` und `NEAR_MATCH`. Sechs Teilnoten, jede von 0 bis 100, und
ein gewichtetes Mittel.

## Die Mathematik

Sei $s_i \in [0, 100]$ die Teilnote der Dimension $i$ und $w_i$ ihr Gewicht.

$$
\text{roh} \;=\; \frac{\sum_i w_i \, s_i}{\sum_i w_i}
\qquad
\text{Punktzahl} \;=\; \min\bigl(\text{roh},\; c\bigr), \quad c \le 99
$$

Also: ein **gewichtetes arithmetisches Mittel**, anschließend an einer
Obergrenze $c$ abgeschnitten, die sich aus dem Unwissen über genau diese Anzeige
ergibt.

### Warum ein gewichtetes Mittel und nicht etwas Kunstvolleres

- **Es ist monoton.** $\partial\,\text{roh} / \partial s_i = w_i / \sum w > 0$:
  jede Verbesserung erhöht die Zahl, keine senkt sie. Anforderung 1 ist damit
  bewiesen und nicht nur behauptet.
- **Es ist zerlegbar.** Der Beitrag jeder Dimension ist $w_i s_i / \sum w$ — man
  kann eine Zeile Punkt für Punkt aufschlüsseln, und genau das tut das
  Detailfenster.
- **Es ist beschränkt.** Bei $s_i \in [0,100]$ liegt das Ergebnis in $[0,100]$,
  ohne Normalisierungsschritt, der niemandem erklärbar wäre.
- **Ein Produktmodell** (Noten multiplizieren) wäre die Alternative. Es bestraft
  eine einzelne schlechte Dimension viel härter — was verlockend klingt, aber
  hier falsch ist: „schlecht genug, um auszuscheiden" ist bereits Stufe 2, und
  was Stufe 2 überlebt hat, soll linear vergleichbar bleiben. Zwei Anzeigen mit
  einer 0 in verschiedenen Dimensionen wären im Produktmodell beide 0 und damit
  unsortierbar.

### Die Gewichte

| Dimension | Gewicht | Warum so hoch/niedrig |
| --- | ---: | --- |
| Preis | 25 % | Die harte Nebenbedingung; sie beendet Gespräche |
| Weg zur Arbeit | 20 % | Jeden Tag, jahrelang |
| Einzugstermin | 20 % | Zu spät frei heißt: jemand zahlt Hotel |
| Zimmer | 15 % | Echte Präferenz, kein Ausschluss |
| Möblierung | 15 % | Angenehm, entscheidet aber nichts |
| Datenlage | 5 % | Kleiner Schubs zu Anzeigen, die man beurteilen kann |

Die Gewichte sind eine **Entscheidung, keine Messung** — dafür fehlen die Daten
(dazu unten „Was noch fehlt"). Sie sind so gewählt, dass die drei Dinge, die den
Fall wirklich entscheiden — Geld, Weg, Zeitpunkt — zusammen 65 % tragen. Die
frühere Verteilung hatte Möblierung bei 35 %, mehr als Preis und Entfernung
zusammen, und den Einzugstermin bei 0 %.

Sie liegen in `DEFAULT_WEIGHTS` an einer Stelle und sind ohne weitere Änderung
austauschbar.

### Die Teilnoten im Einzelnen

**Preis** — verglichen wird die *Warmmiete* mit der Obergrenze des Profils.
Nennt die Anzeige nur eine Kaltmiete, werden die Nebenkosten mit 2,50 €/m²
geschätzt (deutscher Durchschnitt) und die Zahl als „ca." markiert. 100 Punkte
bei ≤ 80 % der Obergrenze, linear fallend bis 0 bei 115 %.

**Weg zur Arbeit** — Luftlinie zwischen Arbeitsort und Wohnung, in Fahrminuten
umgerechnet. Ohne Koordinaten greift eine Postleitzahl-Nachbarschaft; ist auch
die unbekannt, 40 Punkte (nicht 0 — Unwissen ist kein Mangel der Wohnung) und
eine Deckelung, siehe unten.

**Einzugstermin** — die Differenz zwischen „frei ab" und dem Ankunftstag:

| Lage | Punkte |
| --- | ---: |
| Frei vor der Ankunft | 100 |
| Mehr als 60 Tage vorher frei | 80 |
| Bis 7 Tage Lücke | 80 |
| 8–30 Tage Lücke | 50 |
| Über 30 Tage Lücke | 15 |
| Anzeige nennt kein Datum | 35 |
| Kein Ankunftsdatum im Profil | 70 |

Dass „kein Datum" (35) **unter** „zwei Wochen zu spät" (50) liegt, ist Absicht:
„frei ab" ist das Erste, was ein echtes Mietangebot nennt, und eine Wohnung
ohne Datum kann niemand einplanen.

**Zimmer** — 100 bei der Wunschzahl, weniger bei Abweichung nach unten, leicht
weniger nach oben (größer heißt teurer).

**Möblierung** — nach Wunsch des Profils; bei `EITHER` immer 100.

**Datenlage** — Anteil der fünf Kerndaten, die bekannt sind.

### Die Obergrenze: warum es keine 100 gibt

$$
c \;=\; \min\Bigl(99,\; \min_{f \in \text{fehlt}} c_f\Bigr)
$$

| Was fehlt | $c_f$ |
| --- | ---: |
| Kein Einzugsdatum | 82 |
| Entfernung nicht berechenbar | 85 |
| Zimmerzahl unbekannt | 88 |
| Objekttyp unbekannt | 88 |
| Gesamtkosten geschätzt | 92 |
| Möblierung unbekannt (wenn gewünscht) | 92 |

Hundert würde behaupten, wir wüssten alles über eine Wohnung und alles davon
passe. Das ist nie der Fall — also ist die Decke 99, und jede Unbekannte drückt
sie weiter. Der praktische Nutzen ist Anforderung 2: eine Zeile kann nicht mehr
gleichzeitig „100" und „kein Einzugsdatum" sagen. Genau dieser Widerspruch stand
auf dem Bildschirm, bevor es die Grenze gab.

Die Grenze ist **kein Abzug**, sondern ein Maximum: eine vollständige Anzeige
wird durch sie nie schlechter.

### Aktualität: sortiert um, wertet nicht auf

Beim Anzeigen wird die gespeicherte Punktzahl mit einem Frische-Faktor
multipliziert (frisch inseriert und geprüft ↑, seit Tagen unbestätigt ↓) und
anschließend **wieder an derselben Obergrenze** abgeschnitten. Dadurch stehen
neue Anzeigen weiter oben, ohne dass die Zahl über das hinauswächst, was wir
über sie wissen.

### Die Farbe folgt der Zahl

`≥ 80` grün · `60–79` gelb · `< 60` grau. Früher folgte die Farbe dem
Kompatibilitäts-Urteil, weshalb eine 67 grün und eine 74 gelb sein konnte — die
eine Sache, die eine farbcodierte Zahl nie tun darf.

## Was noch fehlt

Ehrlich benannt, damit niemand mehr in die Zahl hineinliest, als drinsteckt:

- **Die Gewichte sind nicht gelernt.** Sobald genug Anfragen mit Ausgang
  vorliegen (Zusage / Absage / keine Antwort), lässt sich eine logistische
  Regression auf „führte zu einer Zusage" rechnen und die Gewichte daraus
  schätzen. Bis dahin sind sie eine begründete Setzung. Die Daten dafür werden
  bereits gesammelt (`ContactAttempt.outcome`).
- **Die Entfernung ist Luftlinie.** Ohne Geocoder gibt es für viele Anzeigen gar
  keine — daher die Deckelung bei 85 statt eines erfundenen Werts.
- **Ausstattungsmerkmale** (Balkon, Aufzug, Erdgeschoss, Haustiere, Stellplatz)
  fließen nicht ein; der Parser liest sie noch nicht verlässlich.

## Wo was steht

| Datei | Inhalt |
| --- | --- |
| `src/domain/ranking/index.ts` | Teilnoten, Gewichte, Obergrenze, `classify()`, `score()` |
| `src/domain/discovery/plausible.ts` | Stufe 1, die Ausschlussregeln |
| `src/domain/rent/index.ts` | Warmmiete-Schätzung und Plausibilität der Miete |
| `src/domain/timing/index.ts` | Termin-Logik und Überbrückungskosten |
| `src/server/ranking.ts` | Bindeglied Datenbank ↔ reine Regeln |
| `tests/ranking.test.ts`, `tests/qualityFilter.test.ts` | Alle Regeln oben, als Tests |

Alle Regeln sind rein und ohne Datenbank testbar. Wer eine Regel ändert, ändert
sie an genau einer Stelle und erhöht `RANK_VERSION` — die App erkennt daran,
welche Bewertungen nach alten Regeln entstanden sind, und rechnet sie neu.
