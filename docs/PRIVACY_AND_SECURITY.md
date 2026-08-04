# Privacy & Security

Interne DSGVO-nahe Praxis für ein kleines Werkzeug.

## Datenkategorien

| Kategorie             | Enthält                                                       | Aufbewahrung / Zugriff                                        |
| --------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| User                  | E-Mail, Name, Rolle, bcrypt-Passworthash.                       | So lange der/die Kolleg:in angestellt ist. Nur Admin bearbeitet.|
| CandidateCase         | Pseudonyme Referenz + Anzeigename + optionale Notizen.          | Aktiv oder archiviert. Löschung per Admin.                    |
| ApplicationMessage    | Vom/von der Kolleg:in eingefügter Anschreibetext.                | Aufbewahrt so lange der Kandidatenfall existiert.             |
| SearchProfile         | Arbeitsort, Budget, Zimmer, WBS-Status.                         | Am Kandidatenfall hängend.                                     |
| Listing / Facts       | Öffentlich zugänglicher Anzeigentext + Parser-Belege.           | Kein persistentes Speichern geschützter Bilder.               |
| ContactAttempt        | Wer, wann, welcher Kandidat, welche Anzeige, Message-Snapshot.  | **Append-only**; wird nicht überschrieben.                     |
| AuditEvent            | Status-Übergänge, Registrierung im Firmen-System.               | Ins Backup, nicht in UI-Rauschen.                              |

**Nicht** gespeichert:

- Ausweise, Aufenthaltsdokumente, Anerkennungsurkunden.
- Medizinische Dokumente.
- Portal-Passwörter.
- Kandidat:innen-Kontaktkanäle jenseits der Suche.

## Zugriff & Auth

- Passwörter mit `bcryptjs`, Cost-Faktor 12.
- Session-Cookie via `iron-session` (AES-256-CBC + HMAC-SHA-256).
  `SESSION_SECRET` mindestens 32 Zeichen, kommt aus dem Secret-Manager.
- Cookie in Produktion `Secure`, `HttpOnly`, `SameSite=Lax`.
- Zwei Rollen: `ADMIN` und `COLLEAGUE`. `requireAdmin()` blockt sensible
  Server Actions (Katalog-Sync etc.).

## Sicherheit

- Alle Eingaben werden serverseitig mit `zod` geprüft (siehe
  `src/app/actions.ts`).
- Prisma-ORM = parametrisierte Queries.
- Import-Beschreibungen werden nicht als HTML gerendert — nur als Text.
- Keine SSRF: die App macht keine outbound-Requests aus User-Input.
- Kein Datei-Upload; ein späterer Upload wäre extra zu prüfen.
- CSRF-Schutz durch Next.js Server-Action-Verifikation.
- Sicherheits-Header: `X-Content-Type-Options: nosniff`, `X-Frame-Options:
  DENY`, restriktive `Permissions-Policy` (siehe `next.config.ts`).
- Rate Limiting für `/login` ist im MVP **nicht** implementiert — für
  Produktions-Deploys per Reverse Proxy (nginx `limit_req`, Cloudflare, o. ä.)
  hinzuzufügen.

## Secrets

- Keine Secrets in Git. `.env` ist gitignored.
- `.env.example` beschreibt jede Variable, enthält keine echten Werte.
- Portal-API-Tokens (falls einmal freigegeben) gehören in den
  Deployment-Secret-Manager, **nicht** in die DB.

## Logging

- Standard-Errors nur mit `level=warn|error`, keine Message-Bodies, keine
  Secrets.
- Keine Third-Party-Analytics. Keine Tracker.

## Backups

- `pg_dump` täglich, an einen sicheren Ort.
- Wiederherstellung: `pg_restore` in eine frische DB, App neu starten.
- Weil die App keinen dateibasierten Zustand hat, gibt es sonst nichts zu
  sichern.

## Löschung

- Kandidatenfall archivieren: `status = ARCHIVED`, Fall verbleibt (wegen
  Kontakt-Historie).
- Vollständiges Löschen: durch Admin-Bedienung eines Prisma-Scripts (bewusst
  nicht in der UI, damit versehentliches Löschen nicht passiert). Kaskaden
  löschen `SearchProfile`, `ApplicationMessage`, Matches, Claims,
  `SystemTransfer`, `ContactAttempt`.

## Zukünftige KI-Grenze

Falls je ein optionaler AIProvider aktiviert wird (`AI_ENRICHMENT_ENABLED=true`):

- Es wird **nie** die `ApplicationMessage` oder Kandidaten-PII an einen
  externen Dienst gesendet.
- Nur der Anzeigentext einzelner Listings, für ambivalente Fälle.
- Ergebnis wird gegen ein Schema validiert; Ausgabe ist als AI-derived
  gekennzeichnet und manuell korrigierbar.
- Standard bleibt: kein KI-Aufruf im normalen Betrieb.
