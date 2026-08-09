# Kandidaten-Priorität und Anfrage-Soll

Zwei verschiedene Fragen, zwei verschiedene Algorithmen:

| Frage | Algorithmus | Dokument |
| --- | --- | --- |
| Welche **Wohnung** soll ich für diesen Kandidaten zuerst anschreiben? | Ranking | `docs/RANKING.md` |
| Welchen **Kandidaten** soll ich überhaupt zuerst bearbeiten, und wie viele Anfragen braucht der? | Priorität | dieses Dokument |

Code: `src/domain/priority/` (rein, testbar), `src/server/priority.ts` (lädt die
echten Zahlen). Tests: `tests/priority.test.ts`.

## 1. Marktschwierigkeit pro Region

Regionen werden über die **ersten drei Ziffern der PLZ** gruppiert (z. B. `749`
für Bad Rappenau und Umgebung). Das ist die Ebene, auf der die Suche tatsächlich
stattfindet. Ohne PLZ dient die Stadt als Schlüssel.

Zwei völlig verschiedene Dinge machen einen Markt schwer — **beide** erhöhen die
Zahl:

- **Konkurrenz** — viele Bewerber pro Wohnung (München, Frankfurt, Heidelberg).
- **Knappheit** — es gibt online fast keine Inserate (ländliche Regionen).

Deshalb gilt:

```
responseDifficulty = (1 − Erfolgsquote / 0,35) × 100
scarcityDifficulty = (1 − Anzeigen pro Suchlauf / 12) × 100
observedDifficulty = max(responseDifficulty, scarcityDifficulty)
```

Der schwierigere der beiden Werte bestimmt die Arbeitslast — beides bedeutet
„mehr Anfragen nötig".

### Startschätzung vs. eigene Daten

Für einen brandneuen Kandidaten gibt es noch keine eigenen Zahlen. Dafür sind in
`src/domain/priority/regionSeeds.ts` **Startschätzungen** hinterlegt. Diese sind
ausdrücklich Schätzungen, keine Messungen — die UI kennzeichnet das auch so
(„Startschätzung 76/100 — noch keine eigenen Daten").

Sobald eigene Anfragen existieren, verschiebt sich das Gewicht:

```
confidence = Anfragen / (Anfragen + 15)
difficulty = confidence × observedDifficulty + (1 − confidence) × Startschätzung
```

Nach ca. 15 Anfragen in einer Region zählt die eigene Messung mehr als die
Schätzung. **Das ist der „mit genug Daten extrapolieren"-Mechanismus.**

### Erfolgsquote mit Glättung

Eine rohe Quote wäre unbrauchbar: 1 Zusage aus 2 Anfragen sind keine 50 %.
Deshalb Beta-Glättung gegen einen konservativen Prior (1 Zusage pro 8 Anfragen):

```
Quote = (Zusagen + 0,125 × 15) / (Anfragen + 15)
```

Kleine Stichprobe → nahe am Prior. Große Stichprobe → konvergiert gegen die
Realität.

**Alle beobachteten Werte werden live aus den echten Daten berechnet** (Listings
und ContactAttempts nach Region gruppiert). Es gibt keine denormalisierten
Zähler, die auseinanderlaufen könnten. Gespeichert wird nur die Startschätzung.

## 2. Anfrage-Soll

Wie viele Anfragen braucht dieser Markt für drei aussichtsreiche Rückmeldungen?

```
Soll = ceil(3 / erwartete Erfolgsquote), begrenzt auf 5 … 60
```

Beispiel: Erfolgsquote 13 % → 24 Anfragen. Erfolgsquote 35 % → 9 Anfragen.

Das beantwortet direkt die Anforderung: Kandidaten, die „ans Ende der Welt"
ziehen, bekommen automatisch ein deutlich höheres Anfrage-Soll.

## 3. Prioritätswert (0–100)

```
Priorität = 0,35 × Einzugstermin
          + 0,20 × Wartezeit
          + 0,25 × Marktschwierigkeit
          + 0,20 × offene Anfragen
```

| Komponente | Bedeutung |
| --- | --- |
| **Einzugstermin** | Überfällig = 100. 90+ Tage entfernt = 0, dazwischen linear. Ohne Datum: schwächerer Ersatzwert aus der Wartezeit (max. 70). |
| **Wartezeit** | Tage seit **Vertragsunterschrift** im Frese-System, nicht seit Anlage des Falls. 30 Tage = 100. |
| **Marktschwierigkeit** | Siehe oben. |
| **Offene Anfragen** | `(Soll − gesendet) / Soll`. Wird um bis zu 70 % reduziert, wenn bereits positive Rückmeldungen vorliegen — wer drei Zusagen hat, ist nicht mehr im Risiko. |

Stufen: **Kritisch** ≥ 75 · **Hoch** ≥ 55 · **Normal** ≥ 35 · **Niedrig** < 35.

Ist `housingSecuredAt` gesetzt, fällt der Wert hart auf 0 — der Fall verlässt die
Warteschlange.

## 4. Warum diese Felder

- `CandidateCase.contractSignedAt` — die Suchuhr startet mit der
  Vertragsunterschrift im bestehenden Frese-System, nicht wenn jemand dazu kam,
  den Fall anzulegen. Nur so ist die Wartezeit ehrlich.
- `SearchProfile.moveInDate` — stärkster Einzelfaktor.
- `CandidateCase.housingSecuredAt` — nimmt den Fall aus der Warteschlange.
- `MarketRegion` — **nur** die Startschätzung, editierbar durch Admins.

## 5. Erklärbarkeit

Jeder Wert kommt mit Begründungen. Die UI zeigt im Kandidaten-Cockpit den
kompletten Aufbau: jede Komponente mit Wert und Gewicht, die Marktbegründung,
die erwartete Erfolgsquote und **wie viel Prozent davon aus eigenen Daten
stammen**. Kein undurchsichtiger Score.

## 6. Kalibrierung

Die Startschätzungen sind bewusst grob. Nach einigen Monaten Betrieb sollten sie
gegen die tatsächlich gemessenen Werte geprüft werden:

1. Regionen mit ≥ 15 eigenen Anfragen heraussuchen.
2. Gemessene Schwierigkeit mit der Startschätzung vergleichen.
3. `MarketRegion.seededDifficulty` nachziehen, damit neue Regionen mit
   ähnlichem Charakter besser starten.

Die Gewichte (35/20/25/20) und die Zielgröße „drei positive Rückmeldungen"
stehen in `PRIORITY_CONFIG` an einer Stelle und sind bewusst leicht zu ändern.
