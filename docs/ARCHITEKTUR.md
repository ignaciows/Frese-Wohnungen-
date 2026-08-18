# Wie der Code aufgebaut ist

Diese Datei ist für die Person gedacht, die das Projekt übernimmt oder daran
mitarbeitet. Sie beantwortet drei Fragen: **welche Schicht macht was**, **wie
kommt eine Wohnung vom Portal in die sortierte Liste**, und **wo fasse ich an,
wenn ich X ändern will**.

Für den Einstieg (installieren, Datenbank, Skripte) siehe `README.md`.

## Drei Schichten, eine Richtung

```
   src/domain  ──▶  src/server  ──▶  src/app
   (Regeln)          (Datenbank,      (Bildschirme,
                      Netz, IO)        Server Actions)
```

Abhängigkeiten zeigen nur nach rechts. Das ist keine Stilfrage, sondern der
Grund, warum die Regeln überhaupt testbar sind.

### `src/domain` — die Regeln, ohne Welt

Reine Funktionen. Kein Prisma, kein `fetch`. Alles, was „heute" wissen muss,
nimmt `now` als Parameter — höchstens mit `= new Date()` als Vorgabe, nie fest
verdrahtet, sodass jeder Test jeden Tag des Jahres stellen kann.

Damit lässt sich jede Regel als Tabelle prüfen: Eingabe rein, Zahl raus, kein
Datenbankaufbau nötig. Deshalb laufen die knapp 500 Tests in unter einer Minute.

| Ordner | Was darin entschieden wird |
| --- | --- |
| `ranking/` | Die Punktzahl und die Kompatibilität einer Wohnung. Siehe `SCORING.md`. |
| `parser/` | Aus Titel und Beschreibung Zahlen machen: Miete, Zimmer, m², Datum. |
| `discovery/` | Was als Wohnung durchgeht (`plausible.ts`) und was Unsinn ist. |
| `timeline/` | Der Fall als Linie: Achse, Wochen, Risikostufen. Siehe `ZEITLEISTE.md`. |
| `timing/` | Alter einer Anzeige, Überbrückungskosten. |
| `sources/` | Der Quellenkatalog und die kanonischen Filter. |
| `contact/` | Telefonnummer, E-Mail und Ansprechpartner aus dem Anzeigentext. Siehe `KONTAKT.md`. |
| `duplicates/`, `rent/`, `priority/`, `whatif/`, `liveness/`, `mail/`, `sharing/` | Je ein abgegrenztes Thema, gleiche Regel: rein und getestet. |

**Die Prüfung, ob das noch stimmt:** kein Treffer bedeutet, die Schicht ist
sauber.

```bash
grep -rl "from '@/lib/prisma'\|from '@/server" src/domain
```

### `src/server` — alles, was die Welt anfasst

Datenbank, HTTP, IMAP, SMTP. Diese Schicht ruft die Regeln auf, sie enthält
keine.

| Datei | Aufgabe |
| --- | --- |
| `discovery.ts` | Der Suchlauf: Quellen planen, parallel abrufen, Treffer melden. |
| `crawler.ts` | Ein einzelner Abruf, mit robots.txt und Pause pro Host. |
| `listingIngest.ts` | Eine rohe Anzeige in die Datenbank, idempotent auf der kanonischen URL. Respektiert Handeinträge (`isOverride`). |
| `ranking.ts` | Übereinstimmungen speichern und neu rechnen. |
| `liveness.ts` | Gibt es die Anzeige noch? |
| `outbound.ts`, `mailIngest.ts` | Anfragen raus, Antworten rein. Siehe `EMAIL_INGEST.md`. |
| `settings.ts` | Regeln, die ohne neue Softwareversion änderbar sein müssen. |
| `timeline.ts`, `touchpoints.ts`, `priority.ts` | Lesen für je einen Bildschirm. |

### `src/app` — Bildschirme

Next.js App Router. Server-Komponenten sind die Regel; `'use client'` steht nur
dort, wo wirklich etwas im Browser passieren muss (Live-Suche, Themenschalter,
Datumsfeld).

* `actions.ts` — alle Server Actions an einem Ort, nach Thema geordnet; das
  Inhaltsverzeichnis steht oben in der Datei. **Diese Datei darf nur
  `async function` exportieren.** Eine exportierte Konstante bricht den
  Produktions-Build, und zwar erst beim `next build`, nicht beim Typecheck —
  das hat schon zwei Deployments gekostet. Konstanten gehören nach
  `src/domain/…`. `tests/serverActions.test.ts` prüft das in einer Sekunde,
  statt es dem Deployment zu überlassen.

  Eine Action entscheidet nichts: sie authentifiziert, prüft das Formular mit
  zod, ruft **eine** Funktion in `src/server` und lädt die Seite neu. Sobald
  eine Action anfängt, über Wohnungen nachzudenken, gehört dieses Denken nach
  `src/domain`.
* `_components/` — geteilte Bausteine.
* `api/*/route.ts` — Endpunkte für Zeitpläne und Webhooks (`health`, `digest`,
  `discovery/run`, `discovery/live`, `ingest/email`, `telegram/webhook`).
* `globals.css` — das gesamte Design als CSS-Variablen. Siehe `DESIGN.md`.

### `src/lib` — kleine Werkzeuge

Prisma-Client, Sitzung, Verschlüsselung, Entfernung, Geld, URL-Normalisierung.
Alles ohne eigene Meinung.

## Der Weg einer Wohnung

```
  Quelle ─▶ Crawler ─▶ Parser ─▶ Plausibilität ─▶ Listing ─▶ Ranking ─▶ Liste
           robots.txt   Zahlen    Unsinn raus     (DB)      pro Fall   sortiert
```

1. **Planen** (`discovery.ts`). Welche Quellen sind freigeschaltet, welche sind
   noch in ihrem Abstand, und braucht dieser Fall überhaupt Möbliertes? Der
   Plan wird gemeldet, bevor der erste Abruf läuft — davon lebt der
   Fortschrittsbalken.
2. **Abrufen** (`crawler.ts`). Nacheinander pro Server und mit Pause;
   robots.txt wird gelesen und befolgt. Nur Kleinanzeigen läuft über diesen
   Weg — ImmoScout24 und Immowelt kommen als Suchagent-Mail herein
   (`server/mailIngest.ts`), landen aber ab Schritt 3 im selben Ablauf.
3. **Lesen** (`domain/parser`). Deutschsprachig und deterministisch: kein LLM.
   Jede erkannte Zahl bekommt eine `ListingFact`-Zeile mit dem Textausschnitt,
   aus dem sie stammt — daher lässt sich später zeigen, *warum* dort 780 €
   steht.
4. **Aussortieren** (`domain/discovery/plausible.ts`). 100 € im Monat,
   20 Zimmer, vier Wochen zur Gamescom — nichts davon ist eine Wohnung, die
   jemand mietet. Die Grenzen stehen in den Einstellungen, nicht im Code.
5. **Speichern** (`listingIngest.ts`). Idempotent auf der kanonischen URL.
   Handeinträge überleben jeden weiteren Durchlauf.
6. **Bewerten** (`ranking.ts` + `domain/ranking`). Eine Zeile je aktivem Fall.
   Die Ausschlussregeln laufen **hier** noch einmal, nicht nur beim Import —
   sonst würde Müll, der schon im Pool liegt, dort für immer bleiben.
7. **Anzeigen**. Streng nach Zahl sortiert, von oben nach unten abzuarbeiten.

Die Live-Suche (`api/discovery/live`) ist derselbe Ablauf, nur meldet er jeden
Schritt als NDJSON-Zeile, damit die ersten Wohnungen nach zehn Sekunden
erscheinen statt nach zwei Minuten gar keine.

## Zwei Versionsnummern, die etwas auslösen

* `RANK_VERSION` in `domain/ranking/index.ts` — hochzählen, sobald sich an der
  Formel etwas ändert. Übereinstimmungen mit älterer Nummer gelten als veraltet
  und werden neu gerechnet.
* `extractorVersion` im Parser — dasselbe für die Extraktion.

Ohne das Hochzählen rechnet die App munter mit alten Zahlen weiter, und der
Unterschied fällt erst Wochen später jemandem auf.

## Wo fasse ich an, wenn ich …

| … ändern will | … dann hier |
| --- | --- |
| wie eine Wohnung bewertet wird | `src/domain/ranking/index.ts` + `tests/ranking.test.ts` |
| was als unmögliche Anzeige gilt | Einstellungen; die Regel steht in `domain/discovery/plausible.ts` |
| eine neue Quelle | `domain/sources/catalog.ts`; die Schritte stehen am Ende von `QUELLEN.md` |
| wie eine Telefonnummer erkannt wird | `domain/contact/index.ts` + `tests/contact.test.ts`, siehe `KONTAKT.md` |
| eine Farbe, irgendeine | die Tokens in `globals.css`, siehe `DESIGN.md` |
| die Zeitleiste | `domain/timeline/index.ts` (Regeln) und `_components/Timeline.tsx` (Zeichnen) |
| einen Text auf dem Bildschirm | die jeweilige `page.tsx`; Beschriftungen sammeln sich in `lib/labels.ts` |
| das Datenbankschema | `prisma/schema.prisma`, danach `npm run db:migrate:dev` |

## Bevor etwas rausgeht

```bash
npx tsc --noEmit     # Typen
npx eslint src/      # Lint
npx vitest run       # rund 470 Tests
npx next build       # ← der wichtige
```

Der letzte Schritt ist nicht optional. Typecheck, Lint und alle Tests waren
schon einmal grün, während der Produktions-Build an einer exportierten
Konstante in `actions.ts` scheiterte. Nur `next build` findet diese Klasse von
Fehlern.

## Was bewusst nicht existiert

* **Keine KI im Normalbetrieb.** Extraktion, Bewertung und Duplikaterkennung
  sind getesteter Code. Das ist billiger, schneller und lässt sich erklären.
* **Keine Anbindung an das Firmen-System.** Statt einer Schnittstelle gibt es
  ein Kopier-Panel mit drei Feldern. Bewusste Entscheidung, siehe
  `ARCHITECTURE_DECISION.md`.
* **Keine automatische Portal-Anmeldung, kein CAPTCHA-Umgehen.** Wo eine Quelle
  serverseitige Abrufe ablehnt, bleibt der manuelle Weg. Gesperrt ist gesperrt.
