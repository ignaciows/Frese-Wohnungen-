# Ranking

Deterministisch, testabgedeckt, konfigurierbar. Kein LLM-Score, keine
verdeckten Modelle. Alle Regeln leben in `src/domain/ranking/index.ts` und
`src/domain/ranking` unit-Tests.

## Zwei Stufen

### 1. Kompatibilität (harte Filter, immer zuerst)

Klassifikation in `COMPATIBLE`, `NEAR_MATCH`, `INCOMPATIBLE`,
`INSUFFICIENT_DATA`. Harte Blocker (Beispiele):

- Objekttyp klar ausgeschlossen (WG-Zimmer, Haus, Verkauf, Gewerbe, Tausch).
- Warmmiete **> 115 %** der Obergrenze (nur wenn Gesamtkosten bekannt).
- Zimmer unter Minimum.
- `wbsRequired = YES` + `wbsStatus = NOT_AVAILABLE`.
- `furnished = REQUIRED` + Anzeige `UNFURNISHED` / `FURNITURE_TAKEOVER`.
- `exchangeRequired = YES`.
- `TEMPORARY`-Objekt außerhalb des Notfall-Modus.

**Unbekannte Werte blockieren nicht.** Sie erzeugen sichtbare Soft-Flags und
verschieben die Anzeige nach `NEAR_MATCH` bzw. reduzieren die Datenqualität.

### 2. Präferenz-Punktzahl (nur für kompatibel + near-match)

Gewichtung (Default, in `DEFAULT_WEIGHTS`):

- Möblierung: **35 %**
- Zimmer-Passung: **25 %**
- Budget: **20 %**
- Anfahrt / Entfernung: **15 %**
- Datenvollständigkeit: **5 %**

Alle Subscores skalieren 0–100; der gewichtete Mittelwert wird auf 0–100
normalisiert.

## Möblierungs-Subscore

| Zustand              | PREFERRED / REQUIRED | EITHER |
| -------------------- | -------------------- | ------ |
| FULLY_FURNISHED      | 100                  | 100    |
| FURNISHED            | 90                   | 100    |
| PARTIALLY_FURNISHED  | 60                   | 100    |
| FURNITURE_TAKEOVER   | 30 (mit Warnung)     | 100    |
| UNFURNISHED          | 20 (PREFERRED)       | 100    |
| UNKNOWN              | 50                   | 100    |

**Wichtig**: Möblierung rettet keine Wohnung, die deutlich über Budget liegt
oder außerhalb des Radius fährt — das sind harte Filter oder tief
gewichtete Subscores.

## Zimmer-Subscore

- `rooms < min` → hart INCOMPATIBLE (nicht nur 0 Punkte).
- `rooms ≥ preferred` → 100.
- Zwischen `min` und `preferred` linear absteigend.
- `rooms` unbekannt → 50.

## Budget-Subscore

Basiert auf `effectiveMonthlyCents`:

- über Budget → `50 - overFraction × 200`, mind. 0.
- am Budget-Limit → 75.
- unter Budget: 75 + bis 25 Bonus (bei 25 % unter Cap).
- Wenn `monthlyTotalComplete = false` (nur Kaltmiete bekannt), maximaler
  Subscore = 55 („innerhalb Budget, aber Kosten unvollständig"). Kaltmiete
  wird **nicht** wie eine Warmmiete behandelt.

## Anfahrts-Subscore

- Bevorzugt Minuten (aus `commuteMinutes` — MVP: coarse Schätzung
  `distanceKm × Geschwindigkeit(Modus)`), sonst `distanceKm` gegen `radiusKm`.
- Unter 60 % des Ziels → 100.
- Am Ziel → 80.
- Über Ziel → linear absteigend, harter Block ab 150 % des Ziels.
- Ohne Koordinaten → 40 (mit sichtbarem „Entfernung unbekannt").

## Datenqualitäts-Subscore

Zählt bekannte Kernfelder: propertyType, furnishing, rooms,
effectiveMonthlyCents, monthlyTotalComplete → 5 Punkte je bekanntes Feld,
skaliert auf 0–100.

## Erklärungen

Jedes Ergebnis liefert `reasons: string[]` — kurze, verständliche Zeilen:

- `+ Vollmöbliert`
- `+ 3 Zimmer ≥ Wunschgröße`
- `+ 120 € unter Budget`
- `~ 22 min Anfahrt`
- `! Nur Kaltmiete bekannt — echte Warmmiete unbekannt`

## Konfigurationspunkte

- Gewichtungen: `DEFAULT_WEIGHTS` (Änderung per Deploy, alternativ in Zukunft
  über `AppSetting`).
- Grenzwerte (z. B. „über Budget → 115 % = hart"): oben in
  `src/domain/ranking/index.ts` sichtbar und getestet.

## Reihenfolge

Standard-Sortierung im UI:

1. `COMPATIBLE` nach Score absteigend.
2. `NEAR_MATCH` nach Score absteigend.
3. `INSUFFICIENT_DATA` — sichtbar, aber zur Review.
4. `INCOMPATIBLE` — nur im Tab „Abgelehnt / Inkompatibel".

Keine Portal-eigene Reihenfolge darf das dominieren.
