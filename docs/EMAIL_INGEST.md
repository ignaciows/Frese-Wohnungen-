# Neue Anzeigen automatisch: Suchagent-Postfach

## Warum kein Scraper

Die naheliegende Idee wäre, ImmoScout24, Kleinanzeigen und Facebook direkt
auszulesen. Das ist bewusst **nicht** gebaut:

- Die Nutzungsbedingungen dieser Portale untersagen automatisiertes Auslesen
  ausdrücklich. Es gibt dazu Abmahnungen und Urteile.
- Facebook-Gruppen sind geschlossene Bereiche mit personenbezogenen Daten
  Dritter. Ein Scraper dort wäre ein DSGVO-Problem, kein Feature.
- Scraper brechen bei jedem Redesign. Ein Werkzeug, das jede zweite Woche
  falsche oder gar keine Daten liefert, verliert genau das Vertrauen, das es
  aufbauen soll.

## Was stattdessen funktioniert

Alle großen Portale bieten **gespeicherte Suchen mit E-Mail-Benachrichtigung**
("Suchagent"). Diese Mails schicken die Portale freiwillig, an eine Adresse, die
wir bestimmen. Sie auszuwerten verletzt keine Bedingungen, braucht keine
Portal-Passwörter in dieser App und überlebt jedes Redesign.

```
Portal-Suchagent  ──E-Mail──▶  gemeinsames Postfach  ──IMAP──▶  Frese Wohnung
                                                                 └▶ Anzeige beim
                                                                    richtigen
                                                                    Kandidaten
```

## Einrichtung

### 1. Postfach

Ein gemeinsames Postfach anlegen, z. B. `wohnungen@frese-recruiting.de`, das
**Plus-Adressierung** unterstützt (Google Workspace, Microsoft 365 und die
meisten Hoster können das).

### 2. Umgebungsvariablen

```
MAIL_IMAP_HOST="imap.example.de"
MAIL_IMAP_PORT="993"
MAIL_IMAP_SECURE="true"
MAIL_IMAP_USER="wohnungen@frese-recruiting.de"
MAIL_IMAP_PASSWORD="…"      # App-Passwort, nicht das normale Kennwort
MAIL_IMAP_MAILBOX="INBOX"
INGEST_TOKEN="…"            # langes Zufallstoken für den Cron-Aufruf
```

Bei Google Workspace / Microsoft 365 ein **App-Passwort** verwenden und IMAP im
Konto freischalten. Das Passwort gehört in den Secret-Manager der Plattform,
niemals in die Datenbank oder ins Repository.

### 3. Suchagent pro Kandidat anlegen

Im Portal mit dem **eigenen Konto** eine Suche speichern und als Empfänger der
Benachrichtigung die Adresse mit Kandidaten-Kennung eintragen:

```
wohnungen+CAND-2026-014@frese-recruiting.de
```

Der Teil nach dem `+` ist die Referenz des Kandidatenfalls. Daran erkennt die
App, zu wem ein Treffer gehört. Alles vor dem `+` landet im selben Postfach.

### 4. Abruf planen

Entweder manuell über **Einstellungen → Suchagent-Postfach → „Postfach jetzt
abrufen"**, oder per Zeitplan:

```bash
curl -X POST \
  -H "x-ingest-token: $INGEST_TOKEN" \
  https://<deine-domain>/api/ingest/email
```

Alle 15–30 Minuten ist ein sinnvoller Rhythmus. Auf Railway geht das über einen
Cron-Service, sonst über jeden externen Cron-Dienst.

## Verhalten

- **Idempotent.** Jede Mail wird über ihre `Message-ID` einmalig verarbeitet.
  Ein doppelter Cron-Lauf erzeugt keine doppelten Anzeigen. Zusätzlich greift
  die normale URL-Normalisierung, sodass dieselbe Wohnung aus zwei Mails
  denselben Datensatz trifft.
- **Nachvollziehbar.** Pro Mail entsteht eine Zeile in `EmailIngestLog` mit
  Status: `PROCESSED`, `NO_LINKS`, `UNKNOWN_SOURCE`, `UNKNOWN_CANDIDATE` oder
  `ERROR`. Die letzten Einträge stehen in den Einstellungen.
- **Ehrlich unvollständig.** Suchagent-Mails enthalten selten den vollen
  Anzeigentext. Importierte Anzeigen haben deshalb Link und Titel, aber oft
  keine Beschreibung — Möblierung und Warmmiete bleiben „unbekannt", bis jemand
  die Anzeige öffnet. Es wird **nichts erfunden**, um die Felder zu füllen.
- **Ein fehlerhafter Link stoppt nichts.** Schlägt eine einzelne Anzeige fehl,
  laufen die übrigen der Mail trotzdem durch.

## Unterstützte Portale

Erkannt werden Anzeigen-Links von ImmoScout24, Immowelt, Kleinanzeigen,
WG-Gesucht, Wunderflats und HousingAnywhere. Weitere Portale sind eine Zeile in
`LISTING_PATTERNS` (`src/domain/mail/index.ts`) — Voraussetzung ist eine
stabile, öffentlich erkennbare Expose-URL.

## Grenzen

- Ein Portal ohne Suchagent-Funktion bleibt manuell. Das ist in Ordnung: die
  Quellen-Checkliste deckt genau diesen Fall ab.
- Facebook-Gruppen und WhatsApp bleiben bewusst außen vor.
- Wer die Benachrichtigung im Portal abbestellt, bekommt hier nichts mehr —
  die App kann das nicht erkennen. Die Wiedervorlage in der Quellen-Checkliste
  ist die Gegenprobe.

---

# Automatische Link-Prüfung (tote Anzeigen)

Suchagent-Mails bringen neue Anzeigen herein — dieser Teil sorgt dafür, dass
alte wieder verschwinden.

## Was passiert

In Abständen (Standard: alle 12 Stunden pro Anzeige) ruft die App jede
importierte Anzeige einmal auf und schaut ausschließlich, **ob die Seite noch
existiert**. Ergebnis pro Anzeige:

| Ergebnis | Bedeutung | Folge |
| --- | --- | --- |
| `ALIVE` | Seite erreichbar | Aktualitäts-Uhr wird zurückgesetzt |
| `GONE` | 404/410, Weiterleitung auf die Suche, oder „nicht mehr verfügbar" im Text | zählt Richtung Ablauf |
| `BLOCKED` | Portal blockiert oder drosselt den Abruf | **keine Folge** |
| `UNKNOWN` | Timeout, DNS, Serverfehler | **keine Folge** |

Erst nach **zwei aufeinanderfolgenden eindeutigen** `GONE`-Ergebnissen wandert
eine Anzeige in den Reiter „Abgelaufen". Alles Uneindeutige setzt den Zähler
zurück. Ein blockierendes Portal kann also niemals eine gute Wohnung
aussortieren.

## Warum das kein Scraping ist

Ein Abruf pro bereits bekannter Anzeige, in großen Abständen, mit Pause
zwischen Anfragen an dasselbe Portal und einem ehrlichen User-Agent. Es werden
keine Suchergebnisse geerntet, keine Anmeldung umgangen und keine Daten
gesammelt, die wir nicht ohnehin schon hatten.

## Einrichtung

Denselben Cron-Mechanismus wie beim Postfach verwenden:

```bash
curl -X POST \
  -H "x-ingest-token: $INGEST_TOKEN" \
  https://<deine-domain>/api/checks/listings
```

Stündlich reicht — welche Anzeigen fällig sind, entscheidet die App selbst.
Manuell geht es über **Einstellungen → Alle fälligen Anzeigen jetzt prüfen**,
oder pro Anzeige über **„Jetzt prüfen"** im Detailbereich.

## Sicherheit

Weil die geprüften URLs aus Nutzereingaben stammen, läuft jeder Abruf durch
einen SSRF-Schutz: nur `http`/`https`, keine internen Hostnamen, keine
privaten IP-Bereiche, keine Cloud-Metadaten-Adresse — und jede Weiterleitung
wird erneut geprüft. Antwortkörper werden bei 64 KB abgeschnitten.

## Einstellbar

Prüfintervall, Anzahl nötiger Treffer bis „abgelaufen", Anzeigen pro Lauf und
die Pause zwischen Abrufen desselben Portals stehen in den Einstellungen.
