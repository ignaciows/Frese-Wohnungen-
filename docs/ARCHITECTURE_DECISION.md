# Architecture Decision Record

Datum: 2026-08-04
Status: **angenommen**

## Kontext

Kleines internes Werkzeug für ein Team mit gemeinsamer Wohnungssuche über
Dutzende Portale. Muss:

- geteilten Zustand für mehrere Kolleg:innen bieten,
- ohne Installation auf beliebigen Office-Rechnern (Mac / Windows) laufen,
- die Portale in der normalen Browser-Session der Kolleg:innen aufrufen
  (dort sind sie eingeloggt und gebunden an ihre Portal-Sessions),
- niedrig in Betriebskosten und Wartungsaufwand sein,
- ohne teure KI funktionieren,
- Ehrlichkeit über Konnektor-Verfügbarkeit erlauben.

## Optionen

| Option                                 | Geteilter Zustand | Setup auf Kolleg:innen-Rechner | Portal-Sessions | Update-Aufwand | Kosten     | Backups          |
|----------------------------------------|-------------------|--------------------------------|-----------------|----------------|------------|------------------|
| **Web-App (Next.js) + zentrale DB**    | ✅ nativ           | keiner (Browser)               | ✅ echter Browser | zentral        | sehr niedrig | Postgres-Backup |
| macOS-Native (SwiftUI) + Cloud-DB      | ⚠️ via Sync-Service | pro Rechner installieren       | Webview / Extern | verteilt       | mittel      | Postgres-Backup |
| Lokale Web-App pro Rechner (SQLite)    | ❌ jeder für sich   | pro Rechner installieren       | ✅               | verteilt       | keine       | manuell         |
| Electron-Wrapper um Web-App            | ✅ (wie Option 1)  | pro Rechner installieren       | Webview          | verteilt       | niedrig     | zentral         |
| PWA installierbar (Option 1 + Manifest)| ✅                 | 1 Klick "Zum Dock"             | ✅               | zentral        | sehr niedrig | zentral         |

## Entscheidung

**Option 1: Next.js 15 App Router + PostgreSQL, mit installierbarer PWA-
Erfahrung (Dock-Symbol auf macOS).** Diese Kombination:

1. Löst geteilten Zustand nativ (eine DB, alle sehen dasselbe).
2. Erfordert keine Installation — Browser genügt, PWA-Modus als optionaler
   Komfort für macOS-Dock.
3. Nutzt die echte Browser-Session der Kolleg:innen für Portal-Interaktionen
   (die App öffnet Anzeigen im normalen Tab).
4. Updates zentral per Deploy — kein Ausrollen auf jeden Mac.
5. Bekannter Stack, wenig Betriebskosten (ein Server + Postgres reicht),
   Backup ist ein Standard-`pg_dump`.

## Verworfen und warum

- **macOS-Native**: teurer in Wartung, App-Store-Politik, keine Windows-
  Kolleg:innen-Abdeckung. Kein signifikanter Vorteil bei einem Werkzeug,
  dessen zentrale Interaktionen (Portale öffnen, kopieren) im Browser leben.
- **Lokale Web-App**: verletzt die Anforderung „ein Team, ein Zustand". Kein
  Weg, doppelte Kontaktversuche verlässlich zu verhindern.
- **Electron-Wrapper**: doppelter Aufwand, Portal-Sessions wären isoliert von
  der normalen Chrome/Safari-Session der Nutzer:innen — nichts gewonnen, dafür
  Aktualisierungen komplizierter.

## Konsequenzen

- **Deployment**: Ein einzelner Prozess (`next start` oder Container),
  hinter Reverse Proxy mit HTTPS. Migrationen per `prisma migrate deploy`
  im Startup-Script.
- **DB-Schema-Änderungen**: nur über Prisma-Migrationen, keine Ad-hoc-DDL.
- **Sessions**: `iron-session` mit verschlüsseltem Cookie. Passwörter mit
  bcrypt.
- **Zustand pro Nutzer:in**: bewusst dünn — die App ist Team-Werkzeug, keine
  persönliche Konfiguration.
- **KI-Grenze**: einziger sanktionierter Eintrittspunkt ist ein
  `AIProvider`-Slot, standardmäßig `false`. Kein KI-Aufruf im V1-Pfad.
- **Portal-Konnektoren**: separates Terms-Review pro Quelle; erst nach
  admin-getriggerter Freischaltung wird eine Quelle aus `MANUAL_ONLY` in
  `APPROVED_FOR_AUTOMATION` gehoben.

## Nicht gebaut, weil nicht nötig

- Message-Queues, Workflow-Engines, Kubernetes, Multi-Service-Architektur,
  Event-Sourcing, Vector-DBs, Redis, ORM-Zweitschichten.
