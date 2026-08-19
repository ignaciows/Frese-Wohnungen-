# Betrieb

Wo die App läuft, was gesetzt sein muss, und was zu tun ist, wenn etwas klemmt.

## Wo sie läuft

| | |
| --- | --- |
| Hosting | Railway, Projekt „Frese Recruiting Wohnungsuche" |
| Adresse | `https://frese-wohnungen-production.up.railway.app` |
| Datenbank | Railway Postgres im selben Projekt |
| Deploy | automatisch bei jedem Push auf `main` |

Der Start (`scripts/start.mjs`) macht der Reihe nach: Migrationen anwenden,
Basisdaten einspielen (idempotent), Next.js starten. Schlägt ein Schritt fehl,
startet die App trotzdem und sagt es unter `/api/diagnostics` — ein laufender
Server mit einer klaren Fehlermeldung ist mehr wert als ein stiller Rollback.

## Der erste Blick, wenn etwas komisch ist

```
https://…/api/diagnostics
```

Prüft Umgebungsvariablen, Datenbank, Migrationsstand und die optionalen
Anbindungen. `"ok": false` nennt immer auch, was genau fehlt.

## Umgebungsvariablen

**Ohne diese läuft nichts:**

| Variable | Wofür |
| --- | --- |
| `DATABASE_URL` | Postgres |
| `SESSION_SECRET` | verschlüsselt das Sitzungs-Cookie (min. 32 Zeichen) |
| `SESSION_SECURE_COOKIE` | in Produktion `true` |

**Ohne diese fehlt jeweils eine Funktion:**

| Variable | Was ohne sie fehlt |
| --- | --- |
| `CREDENTIAL_KEY` | Portal- und Postfach-Passwörter lassen sich nicht speichern. Die App legt sie **nie** im Klartext ab — ohne den Schlüssel verweigert sie das Speichern. |
| `INGEST_TOKEN` | Die Endpunkte `/api/discovery/run` und `/api/ingest/email` antworten mit 503. Der eingebaute Takt (siehe unten) läuft davon unabhängig weiter. |
| `AUTO_SWEEP` | Nur `off` hat eine Wirkung: dann sucht die App nicht mehr von selbst. |
| `APP_URL` | Nötig für Google-Login (die `redirect_uri` muss exakt stimmen). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_ALLOWED_DOMAIN` | Kein „Mit Google anmelden" **und** kein „Postfach mit Google verbinden". Passwort-Anmeldung und IMAP laufen weiter. Siehe `ANMELDUNG.md`. |

⚠️ **`CREDENTIAL_KEY` niemals ändern**, solange Zugangsdaten gespeichert sind —
sie sind damit verschlüsselt und wären danach unlesbar. Die App sagt das dann
auch, aber neu eintragen muss man sie trotzdem.

## Wann von selbst gesucht wird

Drei Wege, und sie stören sich nicht:

1. **Der eingebaute Takt.** Der Serverprozess klopft alle 20 Minuten an
   (`src/instrumentation.ts`) und liest dabei auch die Postfächer. Das ist der
   Weg, der ohne Einrichtung funktioniert und über Nacht und am Wochenende
   läuft — genau dann, wenn gute Wohnungen auftauchen und wieder weg sind.
   Abschalten: `AUTO_SWEEP=off`.
2. **Beim Öffnen eines Kandidaten**, wenn für **diesen** Fall heute noch nicht
   gesucht wurde (siehe `DISCOVERY.md`). Der vierte Besuch am selben Tag sucht
   nichts mehr.
3. **Von außen**: `POST /api/discovery/run` mit dem Header
   `x-ingest-token: <INGEST_TOKEN>`, für alle, die lieber einen echten Cron
   betreiben.

Angeklopft heißt nicht gesucht: ob wirklich abgerufen wird, entscheidet in
allen drei Fällen dieselbe Stelle — die Einstellungen und der Prüfabstand
jeder einzelnen Quelle. Zweimal Klopfen kostet deshalb nichts.

### Was danach gemeldet wird

Nach jedem Suchlauf entsteht **eine Meldung je Fall**, für den etwas
Anschreibbares dazugekommen ist — nicht eine je Anzeige. Ein Suchlauf findet
regelmäßig dreistellige Zahlen; eine Meldung pro Anzeige wäre ein Posteingang,
den niemand durchsieht, und damit so gut wie keine Meldung.

Wohnungen mit Telefonnummer stehen im Titel und die Meldung ganz oben. Fälle
ohne neuen Treffer werden nicht gemeldet: „nichts gefunden" ist keine
Nachricht, dafür gibt es die Stillstands-Warnung auf „Aufgaben & Posteingang",
und die meldet sich nach Tagen statt nach jedem Durchlauf.

## Migrationen

Zwei Regeln, beide teuer gelernt — die Langfassung steht in `START_HIER.md`:

1. **Jede Migration muss sich wiederholen lassen**: `ALTER TABLE IF EXISTS`,
   dazu `IF EXISTS` / `IF NOT EXISTS` an jeder Spalte und jedem Constraint.
   `DROP CONSTRAINT IF EXISTS` alleine reicht nicht — Postgres verlangt
   trotzdem, dass die Tabelle existiert.
2. **Vor jedem `DELETE` nachsehen, wer darauf zeigt.** `Listing` und
   `SourceCheck` zeigen beide mit `ON DELETE RESTRICT` auf `Source`.

Eine gescheiterte Migration ist ansteckend: `migrate deploy` verweigert danach
*jede* weitere (Fehler P3009). Der Start-Skript erkennt das, markiert die
hängende Migration als zurückgerollt und lässt sie noch einmal laufen —
deshalb Regel 1. Klappt auch das nicht, zieht er das Schema per `db push` nach
und sagt dazu, dass die Historie **nicht** aktuell ist.

Von Hand, in der Railway-Konsole des App-Service:

```bash
npx prisma migrate status     # was ist der Stand
npx prisma migrate deploy     # anwenden
```

## Wenn etwas klemmt

| Symptom | Wo nachsehen |
| --- | --- |
| Keine neuen Anzeigen | Einstellungen → Erweiterte Einstellungen → „Letzte Suchläufe". `BLOCKED` bei ImmoScout24/Immowelt ist normal — die laufen über den Suchauftrag. |
| Suchagent-Mails kommen nicht an | Einstellungen → „Suchagent-Postfach": Zeitpunkt der letzten Abholung. Danach `EMAIL_INGEST.md`. |
| „Zugangsdaten können nicht gespeichert werden" | `CREDENTIAL_KEY` fehlt. |
| Anmeldung mit Google schlägt fehl | Stimmt die `redirect_uri` in der Google Cloud Console exakt mit `APP_URL` + `/google/callback` überein? |
| Postfach steht auf „muss neu verbunden werden" | Google hat den Zugriff zurückgezogen. Der Knopf auf der Karte macht es in zwei Klicks wieder gut; siehe `ANMELDUNG.md`. |
| Nichts läuft von selbst | Railway-Logs nach `[takt]` durchsuchen. Steht dort „AUTO_SWEEP=off", ist der Takt abgeschaltet. |
| Deploy „hat nichts getan" | Railway-Logs des App-Service, Zeilen mit `[start]`. |

## Datenbank sichern

Railway sichert den Postgres-Dienst selbst; für einen eigenen Abzug:

```bash
pg_dump "$DATABASE_URL" > frese-wohnung-$(date +%F).sql
```

Wichtig vor jeder Migration, die Spalten oder Tabellen entfernt.
