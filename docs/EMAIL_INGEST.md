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
  Anzeigentext. Was die Mail über eine Anzeige schreibt — meist Kaltmiete,
  Fläche, Zimmerzahl und Stadtteil —, wird als Textblock übernommen und durch
  denselben Parser geschickt wie eine von Hand eingefügte Anzeige. Für
  ImmoScout24 und Immowelt ist das der einzige Text, den die App je bekommt,
  weil beide automatische Abrufe sperren. Was die Mail **nicht** sagt, bleibt
  „unbekannt", bis jemand die Anzeige öffnet: es wird nichts erfunden, um
  Felder zu füllen.
- **Ein fehlerhafter Link stoppt nichts.** Schlägt eine einzelne Anzeige fehl,
  laufen die übrigen der Mail trotzdem durch.

## Unterstützte Portale

Erkannt werden Anzeigen-Links von **ImmoScout24**, **Immowelt** (samt Immonet,
das zur selben Familie gehört) und **Kleinanzeigen**. Ein weiteres Portal ist
eine Zeile in `LISTING_PATTERNS` (`src/domain/mail/index.ts`) — Voraussetzung
ist eine stabile, öffentlich erkennbare Exposé-URL.

## Grenzen

- Ein Portal ohne Suchagent-Funktion bleibt manuell. Das ist in Ordnung: die
  Quellen-Checkliste deckt genau diesen Fall ab.
- Facebook-Gruppen und WhatsApp bleiben bewusst außen vor.
- Wer die Benachrichtigung im Portal abbestellt, bekommt hier nichts mehr —
  die App kann das nicht erkennen. Die Wiedervorlage in der Quellen-Checkliste
  ist die Gegenprobe.

---

# Textprüfung: Ist die Anzeige noch online?

Suchagent-Mails und die automatische Suche bringen neue Anzeigen herein —
dieser Teil sorgt dafür, dass tote wieder verschwinden.

## Warum der Status-Code nicht reicht

Deutsche Portale antworten bei einer zurückgezogenen Anzeige so gut wie nie
mit `404`:

- **ImmoScout24** liefert „Angebot nicht gefunden" als ganz normale Seite.
- **Kleinanzeigen** leitet auf die Suche um — Endstatus `200`.
- **Immowelt** antwortet auf jedes Exposé mit 403 samt Captcha-Seite.

Wer auf einen Status-Code wartet, meldet eine Anzeige also genau so lange als
in Ordnung, bis eine Kollegin sie öffnet und dort liest, dass sie weg ist. Die
App **liest deshalb den Seitentext** — das ist der eigentliche Motor:

- Abschaltungs-Formulierungen („Angebot nicht gefunden", „bereits vermietet",
  „Inserat wurde beendet", …), nach Verlässlichkeit gewichtet;
- Anzeichen für eine lebende Anzeige: Kaltmiete/Wohnfläche/Kaution, Preis,
  schema.org-Auszeichnung, Kontaktmöglichkeit;
- das **Einstelldatum**, das die Anzeige über sich selbst nennt
  („Online seit dem 04.08.2026", „Eingestellt am …", „Online seit 3 Tagen",
  `datePosted` in den strukturierten Daten).

Der Status-Code ist dabei nur noch **ein Signal unter mehreren**.

## Das Ergebnis ist ein Prozentwert

Textlesen ist nie sicher, deshalb ist die Antwort keine Ja/Nein-Aussage,
sondern `onlineConfidence` = 0–100 („diese Anzeige ist zu 70 % noch online").

| Band | Standard | Bedeutung | Folge |
| --- | --- | --- | --- |
| `ALIVE` | ≥ 70 % | bestätigt aktiv | Aktualitäts-Uhr wird zurückgesetzt |
| „zu prüfen" (`UNKNOWN`) | 26–69 % | **nicht eindeutig lesbar** | bleibt sichtbar, eigener Reiter, sinkt im Ranking |
| `GONE` | ≤ 25 % | die Seite sagt es selbst | zählt Richtung Ablauf |
| `BLOCKED` | — | Portal lässt das Auslesen nicht zu (401/403/429, Bot-Wall) | **keine Folge**, letzter Wert bleibt stehen |

Beide Schwellen sind in den Einstellungen verstellbar.

**Das mittlere Band ist Absicht.** Eine Anzeige, die die App nicht sicher lesen
konnte, wird *nicht* stillschweigend ausgeblendet — sie landet im Reiter
„Zu prüfen". Eine falsch versteckte Wohnung sieht sonst nie wieder jemand. Wer
lieber eine kürzere, dafür bestätigte Liste möchte, schaltet in den
Einstellungen **„Nur bestätigt aktive Anzeigen zeigen"** ein.

Erst nach **zwei aufeinanderfolgenden eindeutigen** `GONE`-Ergebnissen wandert
eine Anzeige in den Reiter „Abgelaufen". Alles Uneindeutige setzt den Zähler
zurück. Ein blockierendes Portal kann also niemals eine gute Wohnung
aussortieren.

## Wann geprüft wird

- **Bei jeder Suche.** Öffnet jemand eine Ergebnisliste, werden die Anzeigen
  *dieses* Kandidaten sofort nachgelesen (Standard: 8 Stück, danach 10 Minuten
  Pause pro Kandidat). Damit stimmt die Liste in dem Moment, in dem sie
  gelesen wird.
- **Im Hintergrund**, pro Anzeige im eingestellten Intervall (Standard 12 h).

## Was das Einstelldatum bewirkt

Das Datum, das die Anzeige über sich selbst nennt, ersetzt das Importdatum als
Grundlage der Frische-Anzeige — eine heute gefundene Anzeige kann drei Wochen
alt sein, und genau das entscheidet, ob sich eine Anfrage noch lohnt. Es fließt
zusätzlich in die Sortierung ein: heute inseriert wird angehoben, älter als
drei Wochen abgewertet.

## Ehrliche Grenze

**ImmoScout24 beantwortet Abrufe außerhalb eines Browsers mit `401`.** Die App
kann diese Anzeigen deshalb nicht lesen und sagt das auch so („Portal lässt
automatische Abrufe nicht zu") — statt zu raten. Für ImmoScout24 bleibt der
Weg über den Suchagenten per Mail und das manuelle Öffnen.

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
