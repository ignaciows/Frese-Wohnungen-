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
| `INGEST_TOKEN` | Der Zeitplan kann keinen Suchlauf starten. Nachts und am Wochenende wird dann nicht gesucht — genau dann, wenn gute Wohnungen auftauchen und wieder weg sind. |
| `APP_URL` | Nötig für Google-Login (die `redirect_uri` muss exakt stimmen). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_ALLOWED_DOMAIN` | Kein „Mit Google anmelden". Passwort-Anmeldung läuft weiter. Siehe `ANMELDUNG.md`. |

⚠️ **`CREDENTIAL_KEY` niemals ändern**, solange Zugangsdaten gespeichert sind —
sie sind damit verschlüsselt und wären danach unlesbar. Die App sagt das dann
auch, aber neu eintragen muss man sie trotzdem.

## Der nächtliche Suchlauf

`POST /api/discovery/run` mit dem Header `x-ingest-token: <INGEST_TOKEN>`.
Alle paar Minuten aufrufen; welche Quelle wirklich drankommt, entscheidet dann
ihr eigener Prüfabstand. Einrichten lässt sich das als Railway-Cron oder mit
jedem externen Dienst.

Unabhängig davon sucht die App beim Öffnen eines Kandidaten, wenn für **diesen**
Kandidaten heute noch nicht gesucht wurde (siehe `DISCOVERY.md`).

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
| Deploy „hat nichts getan" | Railway-Logs des App-Service, Zeilen mit `[start]`. |

## Datenbank sichern

Railway sichert den Postgres-Dienst selbst; für einen eigenen Abzug:

```bash
pg_dump "$DATABASE_URL" > frese-wohnung-$(date +%F).sql
```

Wichtig vor jeder Migration, die Spalten oder Tabellen entfernt.
