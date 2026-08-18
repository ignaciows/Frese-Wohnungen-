# Start hier

Für die Person, die das Projekt übernimmt. Eine halbe Stunde Lesen, dann weißt
du, was das Ding tut, wo was liegt und wo du anfasst.

## Was die App eigentlich macht

Frese Recruiting holt Pflegekräfte aus dem Ausland nach Deutschland. Die müssen
wohnen. Jemand im Büro sucht dafür Wohnungen, schreibt Vermieter an und hält
nach, wer geantwortet hat — für zehn bis zwanzig Leute gleichzeitig, in
Browser-Tabs und einer Excel-Tabelle.

Diese App ist die Ablösung dafür. In einem Satz:

> Sie holt Wohnungen von drei Portalen, sortiert sie danach, wie gut sie zu
> einem konkreten Kandidaten passen, und hält fest, wer wen wann angeschrieben
> hat.

Das war's. Es ist kein Immobilienportal und keine CRM-Suite.

## Der Weg einer Wohnung, in sechs Schritten

```
  Portal ──▶ Suchlauf / Suchagent-Mail ──▶ Parser ──▶ Plausibilität
                                                          │
                                     Datenbank ◀──────────┘
                                          │
                                       Ranking ──▶ sortierte Liste ──▶ Anfrage
```

1. **Herein** — entweder liest der Suchlauf die Ergebnisliste von Kleinanzeigen
   (`src/server/discovery.ts`), oder eine Suchagent-Mail von ImmoScout24 /
   Immowelt wird aus dem Postfach geholt (`src/server/mailIngest.ts`), oder
   jemand fügt eine Anzeige von Hand ein.
2. **Lesen** — `src/domain/parser` macht aus deutschem Anzeigentext Zahlen:
   Warmmiete, Zimmer, m², „frei ab", WBS-Pflicht. Deterministisch, kein LLM.
3. **Kontakt** — `src/domain/contact` liest Telefonnummer, E-Mail und
   Ansprechpartner heraus. Siehe `KONTAKT.md`.
4. **Aussortieren** — `src/domain/discovery/plausible.ts` wirft weg, was keine
   Wohnung ist: 100 € im Monat, 20 Zimmer, Monteurzimmer für zwei Wochen.
5. **Speichern** — `src/server/listingIngest.ts`. Idempotent auf der
   normalisierten URL, damit dieselbe Wohnung nicht dreimal in der Liste steht.
6. **Bewerten** — `src/domain/ranking` gibt jeder Wohnung pro Kandidat eine
   Punktzahl. Die Formel und ihre Begründung stehen in `SCORING.md`.

## Wo was liegt

```
src/domain/   Regeln. Reine Funktionen, kein Prisma, kein fetch.
src/server/   Datenbank, Netz, IO. Ruft domain/ auf.
src/app/      Next.js: Seiten, Komponenten, Server Actions.
prisma/       Schema und Migrationen.
tests/        ~470 Tests, davon die meisten ohne Datenbank.
docs/         Dieses Verzeichnis.
```

Abhängigkeiten zeigen nur nach rechts: `domain` weiß nichts von `server`, und
`server` weiß nichts von `app`. Das ist der Grund, warum die Regeln testbar
sind — und die einzige Architekturregel, die wirklich eingehalten werden muss.

Mehr Detail: `ARCHITEKTUR.md`.

## Die drei Dinge, die man zuerst missversteht

**1. Es gibt drei Quellen, und sie funktionieren unterschiedlich.**
Kleinanzeigen liest die App selbst. ImmoScout24 und Immowelt sperren
automatische Abrufe — die schicken ihre Treffer per Suchauftrag an ein
Postfach, das die App mitliest. Das ist keine Notlösung, sondern der einzige
erlaubte Weg. `QUELLEN.md`.

**2. „Blockiert" wird nie umgangen.** Kein CAPTCHA-Bypass, kein getarnter
User-Agent, keine Proxy-Rotation, keine automatische Portal-Anmeldung. Wenn ein
Portal nein sagt, wird das protokolliert und angezeigt. Das ist eine
Produktentscheidung, keine technische Lücke — bitte nicht „reparieren".

**3. Es gibt keine KI im Normalbetrieb.** Extraktion, Bewertung und
Duplikaterkennung sind getesteter Code mit Regex und Arithmetik. Das ist
billiger, schneller, erklärbar und ändert sich nicht über Nacht.

## Lokal zum Laufen bringen

Steht in `README.md` (Node 22, Postgres 16, `npm install`, `db:migrate`,
`db:seed`, `dev`). Der Seed legt einen Demo-Kandidaten mit ein paar Wohnungen
an — das ist der schnellste Weg, die App gefüllt zu sehen.

## Datenbank-Migrationen

Zwei Regeln, beide teuer gelernt:

**1. Jede Migration muss sich wiederholen lassen.** Also `IF EXISTS` /
`IF NOT EXISTS` überall. Scheitert eine Migration mittendrin, markiert Prisma
sie als „failed" — und danach verweigert `migrate deploy` *jede* weitere
Migration (Fehler P3009). Aus diesem Zustand kommt man nur heraus, indem man
die Migration noch einmal laufen lässt. Geht das nicht, bleibt nur `db push`,
und dann stimmt zwar das Schema, aber jeder Datenschritt jeder künftigen
Migration läuft still nie.

`scripts/start.mjs` erkennt so einen Zustand beim Booten und räumt ihn auf —
verlassen sollte man sich darauf trotzdem nicht.

**2. Vor jedem `DELETE` prüfen, wer noch darauf zeigt.** `Listing` und
`SourceCheck` zeigen beide mit `ON DELETE RESTRICT` auf `Source`. Eine
Löschregel, die nur eine der beiden kennt, läuft in der leeren
Entwicklungsdatenbank durch und stirbt in der echten. Genau so ist der erste
Produktiv-Deploy der Drei-Quellen-Umstellung gescheitert.

## Bevor du etwas pushst

```bash
npx tsc --noEmit     # Typen
npm run lint
npm test             # ~470 Tests
npm run build        # ← der wichtige
```

Der letzte ist nicht optional. Typecheck, Lint und Tests waren schon einmal
grün, während der Produktions-Build an einer exportierten Konstante in einer
`"use server"`-Datei scheiterte. Nur `next build` findet diese Klasse Fehler.

Für Tests mit Datenbank braucht es `TEST_DATABASE_URL` in `.env` — eine eigene
Datenbank, deren Inhalt die Tests löschen.

## Wo fasse ich an, wenn ich …

| … ändern will | … dann hier |
| --- | --- |
| wie eine Wohnung bewertet wird | `domain/ranking/index.ts` + `tests/ranking.test.ts`, siehe `SCORING.md` |
| wie eine Telefonnummer erkannt wird | `domain/contact/index.ts` + `tests/contact.test.ts`, siehe `KONTAKT.md` |
| eine Quelle hinzufügen oder anschließen | `domain/sources/catalog.ts`, siehe `QUELLEN.md` |
| was der Parser aus Text liest | `domain/parser/patterns.ts` + `tests/parser.test.ts` |
| was als unmögliche Anzeige gilt | Einstellungen; Regel in `domain/discovery/plausible.ts` |
| einen Text auf dem Bildschirm | die jeweilige `page.tsx`; Beschriftungen in `lib/labels.ts` |
| eine Farbe | die Tokens in `globals.css`, siehe `DESIGN.md` |
| wer sich anmelden darf | `lib/googleAuth.ts`, siehe `ANMELDUNG.md` |
| das Datenbankschema | `prisma/schema.prisma`, danach `npm run db:migrate:dev` |

## Zwei Versionsnummern, die etwas auslösen

- `RANK_VERSION` in `domain/ranking/index.ts` — hochzählen, sobald sich an der
  Formel etwas ändert. Ältere Bewertungen gelten dann als veraltet und werden
  neu gerechnet.
- `EXTRACTOR_VERSION` in `domain/parser/index.ts` — dasselbe für die Extraktion.

Ohne Hochzählen rechnet die App mit alten Zahlen weiter, und es fällt erst
Wochen später auf.

## Die übrigen Dokumente

| Datei | Wofür |
| --- | --- |
| `ARCHITEKTUR.md` | Schichten, Datenfluss, Einstiegspunkte — die lange Fassung |
| `ANMELDUNG.md` | Passwort und „Mit Google anmelden" einrichten |
| `QUELLEN.md` | Kleinanzeigen, ImmoScout24, Immowelt anschließen |
| `KONTAKT.md` | Telefonnummer & Co. aus dem Anzeigentext |
| `DISCOVERY.md` | Suchlauf: Adapter, robots.txt, Höflichkeit, Grenzen |
| `EMAIL_INGEST.md` | Postfach lesen, Antworten zuordnen, Textprüfung |
| `SCORING.md` / `RANKING.md` | Die Punktzahl und warum diese Mathematik |
| `PRIORITY.md` | Welcher Kandidat als nächstes dran ist |
| `ZEITLEISTE.md` | Die Zeitleiste eines Falls |
| `TELEGRAM.md` | Push-Benachrichtigungen und Notizen per Chat |
| `PRIVACY_AND_SECURITY.md` | Datenkategorien, Zugriff, Secrets |
| `DESIGN.md` | Farb-Tokens, Tag- und Nachtansicht |
| `PRODUCT_BRIEF.md` | Nutzer, Problem, Akzeptanzkriterien |
| `ARCHITECTURE_DECISION.md` | Welche Optionen verglichen wurden, und warum diese |
