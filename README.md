# Frese Wohnung

Interne Wohnungssuche-Werkbank für Frese Recruiting GmbH. Organisiert die
Wohnungssuche für internationale Pflegekräfte über alle relevanten Quellen
hinweg — auch dort, wo die Recherche manuell bleiben muss — und macht die drei
Pflichtfelder für das bestehende Firmen-System per Klick kopierbar.

Ausdrückliche Prinzipien:

- **Ehrliche Automatisierung.** Quellen werden automatisch durchsucht, aber nur
  so weit, wie sie es selbst erlauben: die robots.txt wird gelesen und
  befolgt, es wird einzeln und mit Pausen angefragt, und die App meldet sich
  mit einer echten Kennung. Sperren werden protokolliert, nicht umgangen — kein
  CAPTCHA-Bypass, keine getarnten User-Agents, keine Anmelde-Automatik. Wo eine
  Quelle automatische Abrufe verweigert (ImmoScout24, Immowelt), bleibt der
  E-Mail-Suchauftrag oder der strukturierte manuelle Task.
- **Deterministisch statt LLM.** Extraktion, Ranking und Duplikat-Erkennung
  laufen als getesteter deutschsprachiger Parser. Es gibt keinen AI-Pfad, der
  im normalen Betrieb Kosten verursacht.
- **Keine Integration mit dem bestehenden Firmen-System.** Statt einer API
  liefert die App ein prominentes Kopier-Panel mit exakt drei Feldern:
  Wohnung/Objekt, Link, Ort.
- **Ein Bildschirm beantwortet die tägliche Frage:** Welche Wohnung als
  nächstes kontaktieren, warum, hat jemand schon losgelegt, und was muss ich
  danach ins Firmen-System übertragen?
- **Nur, was es noch gibt.** Die Liste zeigt aktive Anzeigen und alles, was
  bereits angeschrieben wurde. Verschwundene Anzeigen werden automatisch
  ausgeblendet — aber erst, wenn sie mehrfach hintereinander fehlten, damit
  eine Störung beim Portal keine gute Wohnung begräbt.

## Voraussetzungen

- Node.js 22 (Next.js 15 App Router).
- PostgreSQL 16 (oder kompatibel; der App reicht ein normaler Postgres).
- Ein einzelner geteilter Datenbank-Server für alle Kolleg:innen.

## Setup (lokal)

```bash
# 1. Env
cp .env.example .env
# SESSION_SECRET setzen (min. 32 Zeichen):
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 2. Datenbank
createdb frese_wohnung
createdb frese_wohnung_test

# 3. Abhängigkeiten
npm install

# 4. Schema anlegen
npm run db:migrate

# 5. Demo-Daten (nur zum Ausprobieren; Passwörter aus SEED_ADMIN_PASSWORD)
npm run db:seed

# 6. Dev-Server
npm run dev
# → http://localhost:3000
```

Demo-Login nach `npm run db:seed`:

- Admin: `admin@frese-wohnung.local`
- Kollegin: `kollegin@frese-wohnung.local`
- Beide Passwörter aus `SEED_ADMIN_PASSWORD` (Default: `demo-admin-pw-2026`).
  Vor produktivem Einsatz **unbedingt** über die DB (oder durch echtes User-
  Anlegen und Löschen des Demo-Accounts) austauschen.

## Deployment

- Umgebung braucht: Node 22, ein Postgres-Server, ausgehendes HTTPS optional.
- `SESSION_SECRET` und `DATABASE_URL` gehören in den Secret-Manager der
  Plattform. Nichts davon in Git committen.
- `SESSION_SECURE_COOKIE=true` in Produktion (HTTPS-only).
- Migrationen mit `npm run db:migrate` (nicht Ad-hoc DDL).
- Ein produktiver Build wird mit `npm run build && npm start` gestartet.
- Backups laufen als normales Postgres-Backup; alle Zustände liegen in der DB,
  es gibt keine Datei-Uploads.

## Scripts

| Script                     | Zweck                                                        |
| -------------------------- | ------------------------------------------------------------ |
| `npm run dev`              | Dev-Server (App Router, Hot Reload).                         |
| `npm run build`            | Produktions-Build.                                           |
| `npm start`                | Startet den produktiven Server.                              |
| `npm run typecheck`        | `tsc --noEmit`.                                              |
| `npm run lint`             | ESLint mit `next/core-web-vitals` + `next/typescript`.       |
| `npm test`                 | Vitest (Parser, Ranking, Duplikate, Planner, Workflow).      |
| `npm run db:migrate`       | Prisma-Migrationen deployen.                                 |
| `npm run db:migrate:dev`   | Migrationen im Dev-Modus erzeugen.                           |
| `npm run db:seed`          | Quellenkatalog + Demo-Kandidat + 8 Beispiel-Anzeigen.        |
| `npm run db:reset`         | Datenbank verwerfen und neu migrieren (nur Entwicklung).     |

Diagnose-Skripte (nur Entwicklung, nicht Teil der App):

| Skript                                        | Zweck                                                        |
| --------------------------------------------- | ------------------------------------------------------------ |
| `npx tsx scripts/dev-sweep.mts`               | Einen echten Suchlauf ausführen und Ergebnis je Quelle zeigen. |
| `npx tsx scripts/dev-parse.mts <adapter> <url>` | Eine URL abrufen und zeigen, was der Adapter daraus liest.   |

## Automatische Suche, Kontakt und Aufgaben

- **Anzeigen finden**: Freigeschaltete Quellen werden regelmäßig nach neuen
  Anzeigen durchsucht (Kleinanzeigen und WG-Gesucht direkt, weitere Seiten über
  Feed-, schema.org-, Linklisten- und Sitemap-Verfahren rein per
  Konfiguration). Details, Grenzen und die robots.txt-Auswertung stehen in
  `docs/DISCOVERY.md`.
- **Anzeigen prüfen**: Vor jeder Ergebnisliste liest die App die Anzeigenseiten
  im Text nach — Abschaltungs-Formulierungen („Angebot nicht gefunden",
  „bereits vermietet"), Anzeigendaten und das Einstelldatum („Online seit dem
  04.08.2026"). Der Status-Code allein taugt nicht: die großen Portale liefern
  eine gelöschte Anzeige als ganz normale `200`-Seite aus. Ergebnis ist ein
  Prozentwert; Anzeigen dazwischen landen im Reiter **„Zu prüfen"** statt
  stillschweigend zu verschwinden. Details in `docs/EMAIL_INGEST.md`.
- **Anfragen senden**: Wo eine Anzeige selbst eine E-Mail-Adresse
  veröffentlicht, geht die Anfrage direkt aus der App raus. Der Kontakt wird
  dabei *vor* dem Versand erfasst — eine erfasste, nicht zugestellte Anfrage
  ist sichtbar und wiederholbar, eine gesendete ohne Eintrag führt dazu, dass
  jemand denselben Vermieter ein zweites Mal anschreibt.
- **Antworten zuordnen**: Jede Anfrage bekommt eine eindeutige Kennung in der
  Antwortadresse. Antworten landen automatisch im richtigen Gespräch, ohne
  Rätselraten am Betreff.
- **Wiedervorlagen**: Eine gesendete Anfrage legt automatisch „Antwort prüfen"
  an; eine eingehende Antwort schließt die Aufgabe wieder. Alles Fällige steht
  unter **Aufgaben & Posteingang**.
- **Zugangsdaten**: Postfach und Portal-Konten liegen unter „Einstellungen →
  Konten & Postfach", verschlüsselt mit `CREDENTIAL_KEY`. Ohne diesen Schlüssel
  speichert die App kein Passwort — statt einer schwächeren Ablage gibt es eine
  klare Fehlermeldung.

## Grenzen und ehrliche Zusagen

- **Gesperrte Portale**: ImmoScout24 (HTTP 401) und Immowelt (HTTP 403) lehnen
  serverseitige Abrufe ab. Sie werden nicht umgangen; dort bleiben der
  E-Mail-Suchauftrag und der manuelle Weg.
- **Kleinanzeigen-Umkreis**: Deren robots.txt sperrt die Umkreis- und
  Preisfilter. Die App liest die ungefilterte Ortsliste und filtert selbst;
  mehrere hinterlegte Ortsnummern ersetzen den Radius.
- **Portal-Anmeldung**: Die App loggt sich nirgends automatisch ein. Ein
  hinterlegtes Portal-Konto dokumentiert, mit welchem Zugang gearbeitet wird —
  angemeldet wird sich weiterhin im Portal.
- **Portal-Konnektoren**: Quellen ohne geprüftes Verfahren bleiben
  `SEARCH_LINK`, `BROWSER_ONLY` oder `REGIONAL_DIRECTORY`. Freischaltung erfolgt
  pro Quelle nach Terms-Prüfung — siehe `docs/PORTAL_INTEGRATIONS.md`.
- **Geokodierung**: Ohne konfigurierten Geokoder werden Entfernungen als
  „unbekannt" angezeigt. Manuell eingetragene Koordinaten funktionieren.
- **KI**: Standardmäßig deaktiviert. Ein Slot (`AIProvider`) ist vorbereitet,
  wird aber vom V1-Pfad nicht benötigt.
- **Firmen-System**: Keine API-Anbindung geplant. Bewusst manueller Transfer
  per Kopier-Panel.

## Weitere Dokumente

- `docs/DISCOVERY.md` — automatische Suche: Verfahren, robots.txt, Grenzen.
- `docs/PRODUCT_BRIEF.md` — Nutzer, Problem, Journey, Akzeptanzkriterien.
- `docs/ARCHITECTURE_DECISION.md` — verglichene Optionen und Begründung.
- `docs/PORTAL_INTEGRATIONS.md` — pro Quelle: Modus, offizielle Referenz,
  geprüft am, was ist umgesetzt.
- `docs/SOURCE_ORCHESTRATION.md` — kanonische Filter, Mapping-Qualität,
  Rezepte, Suchlauf-Zustände.
- `docs/RANKING.md` — harte Filter, Punkte-Formel, Gewichtung.
- `docs/PRIVACY_AND_SECURITY.md` — Datenkategorien, Zugriff, Secrets,
  KI-Grenze.
