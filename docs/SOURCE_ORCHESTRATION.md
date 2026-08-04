# Source Orchestration

## Zwei Ebenen, sauber getrennt

1. **Such-Orchestrierung** — betrifft **jede** aktive relevante Quelle.
   Ein Suchlauf ist eine Sammelaufgabe: eine Aufgabe pro Quelle mit Status,
   Rezept und Anspruch.
2. **Automatischer Ergebnis-Import** — betrifft nur autorisierte Quellen.
   Ohne Autorisierung importiert der/die Kolleg:in manuell aus dem Portal.

Beide Ergebnisströme fließen durch **denselben** Ranking-Pipeline: parseListing →
CandidateListingMatch.

## Kanonische Filter

Definiert in `src/domain/sources/canonicalFilters.ts`:

- `location`
- `radiusKm`
- `commuteMinutes`
- `maxWarmmiete`
- `minRooms`
- `propertyType`
- `furnished`
- `wbs`
- `minLivingSpace`
- `availableFrom`
- `pets`

Diese Menge ist bewusst klein. Jede Quelle deklariert für jeden Filter eine
Mapping-Qualität:

- **EXACT** — Portal-Filter deckt sich 1:1.
- **APPROXIMATE** — der nächste verfügbare Portal-Filter ist breiter oder
  leicht anders (z. B. Portal filtert Kaltmiete statt Warmmiete → wir suchen
  breiter und filtern nach Import selbst).
- **MANUAL** — kein Filter, nur im Anzeigentext prüfbar.
- **UNSUPPORTED** — das Portal kann diesen Filter nicht.
- **UNKNOWN** — noch nicht verifiziert.

## Rezept

Der Rezept-Generator (`buildRecipe`) baut aus Profil + Mapping eine
menschliche Tabelle:

| Filter | Wunschwert | Portal-Qualität | Portal-Label | Handlungshinweis |
| ------ | ---------- | --------------- | ------------ | ---------------- |

Wichtige Regeln:

- Ein UNSUPPORTED-Filter wird **nie stillschweigend gedroppt** — er erscheint
  im Rezept mit klarer Ansage „Portal kann das nicht — nach Import prüfen".
- Ein APPROXIMATE-Mapping bekommt den Hinweis „Portal-Filter breiter setzen;
  Frese Wohnung filtert nach Import exakt".
- Wenn `searchUrlValidated = false` (Default), wird **keine URL erzeugt**. Der
  Task öffnet die Startseite und zeigt das Rezept — statt Falsches zu
  suggerieren.

## Suchlauf-Zustände

Pro Quelle im Suchlauf ein `SourceCheck` mit Status:

| Status                    | Bedeutung                                                                 |
| ------------------------- | ------------------------------------------------------------------------- |
| PENDING                   | angelegt, noch nicht bearbeitet.                                          |
| IN_PROGRESS               | jemand arbeitet aktiv daran (mit `claimedUntil`-Zeit).                     |
| CHECKED_NO_RESULTS        | manuell geprüft — keine passenden Anzeigen. **Erster-Klasse-Ergebnis.**    |
| CHECKED_RESULTS_IMPORTED  | Kolleg:in hat Anzeigen importiert.                                        |
| UNAVAILABLE               | Portal aktuell nicht erreichbar (mit Grund).                              |
| SKIPPED                   | Bewusst übersprungen.                                                     |

Manuell abgeschlossene Quellen sind **kein Fehler und keine Warnung** — sie
sind normales Team-Werkzeug.

## Snapshot-Regel

Beim Anlegen eines Suchlaufs wird für jeden SourceCheck ein
`mappingSnapshot` und `recipeSnapshot` gespeichert. Änderungen am
Quellenregister danach ändern **nicht** die Historie eines Suchlaufs. Das ist
Teil der Test-Suite (`workflow.test.ts` — „editing a source mapping later
does not rewrite the run snapshot").

## Ein-Kandidat-viele-Portale, eine Recherche

Die UX zeigt eine Kandidatin, eine Suche, eine Checkliste, ein
Ergebnisinbox — obwohl die tatsächliche Ausführung teils manuell ist.
Wichtig: nirgends behaupten wir, alle Portale würden gleichzeitig echt
gescraped. Der Fortschritt ist real, die Recipes sind ehrlich.
