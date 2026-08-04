# Frese Wohnung

Interne Wohnungssuche-Werkbank für Frese Recruiting GmbH. Organisiert die
Wohnungssuche für internationale Pflegekräfte über alle relevanten Quellen
hinweg — auch dort, wo die Recherche manuell bleiben muss — und macht die drei
Pflichtfelder für das bestehende Firmen-System per Klick kopierbar.

Ausdrückliche Prinzipien:

- **Ehrliche Automatisierung.** Kein Portal wird gescraped oder umgangen. Wo es
  keine autorisierte Integration gibt, gibt es einen strukturierten manuellen
  Task — nicht das Ausblenden der Quelle.
- **Deterministisch statt LLM.** Extraktion, Ranking und Duplikat-Erkennung
  laufen als getesteter deutschsprachiger Parser. Es gibt keinen AI-Pfad, der
  im normalen Betrieb Kosten verursacht.
- **Keine Integration mit dem bestehenden Firmen-System.** Statt einer API
  liefert die App ein prominentes Kopier-Panel mit exakt drei Feldern:
  Wohnung/Objekt, Link, Ort.
- **Ein Bildschirm beantwortet die tägliche Frage:** Welche Wohnung als
  nächstes kontaktieren, warum, hat jemand schon losgelegt, und was muss ich
  danach ins Firmen-System übertragen?

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

## Grenzen und ehrliche Zusagen

- **Portal-Konnektoren**: Der Seed markiert alle Portale als `SEARCH_LINK`,
  `BROWSER_ONLY` oder `REGIONAL_DIRECTORY`. Kein Konnektor ruft im Auslieferungs-
  zustand echte Portal-Daten ab. Freischaltung erfolgt pro Quelle nach
  Terms-Prüfung — siehe `docs/PORTAL_INTEGRATIONS.md`.
- **Geokodierung**: Ohne konfigurierten Geokoder werden Entfernungen als
  „unbekannt" angezeigt. Manuell eingetragene Koordinaten funktionieren.
- **KI**: Standardmäßig deaktiviert. Ein Slot (`AIProvider`) ist vorbereitet,
  wird aber vom V1-Pfad nicht benötigt.
- **Firmen-System**: Keine API-Anbindung geplant. Bewusst manueller Transfer
  per Kopier-Panel.

## Weitere Dokumente

- `docs/PRODUCT_BRIEF.md` — Nutzer, Problem, Journey, Akzeptanzkriterien.
- `docs/ARCHITECTURE_DECISION.md` — verglichene Optionen und Begründung.
- `docs/PORTAL_INTEGRATIONS.md` — pro Quelle: Modus, offizielle Referenz,
  geprüft am, was ist umgesetzt.
- `docs/SOURCE_ORCHESTRATION.md` — kanonische Filter, Mapping-Qualität,
  Rezepte, Suchlauf-Zustände.
- `docs/RANKING.md` — harte Filter, Punkte-Formel, Gewichtung.
- `docs/PRIVACY_AND_SECURITY.md` — Datenkategorien, Zugriff, Secrets,
  KI-Grenze.
