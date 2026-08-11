# Automatische Suche (Discovery)

Wie die App selbstständig Anzeigen findet, aktuell hält und verschwundene
wieder entfernt.

## Warum es das gibt

Vorher kamen Anzeigen nur über zwei Wege in die App: jemand fügte einen Link
ein, oder ein Portal schickte eine Suchagent-Mail. Beides ist Handarbeit, und
niemand räumt hinterher auf. Ergebnis: Kleinanzeigen tauchte gar nicht auf, und
die Liste füllte sich mit Wohnungen, die längst vergeben waren.

Die automatische Suche fragt jede freigeschaltete Quelle nach ihrer eigenen
Ergebnisliste, gleicht sie mit dem ab, was wir kennen, und macht daraus drei
Dinge: neue Anzeigen, bestätigte Anzeigen, verschwundene Anzeigen.

## Was tatsächlich funktioniert — und was nicht

Am 2026-08-10 wurden 46 deutsche Wohnungsquellen live geprüft. Das Ergebnis ist
ernüchternd und gehört hierher, weil es die Grenze der Methode zeigt:

| Ergebnis | Anzahl | Bedeutung |
| --- | --- | --- |
| automatisch lesbar | 8 | Feed, schema.org oder Linkliste greifen. |
| kein Muster erkennbar | 28 | Die Seite baut ihre Ergebnisliste erst im Browser zusammen (JavaScript). Per Abruf ist dort nichts zu sehen. |
| blockiert | 7 | Das Portal weist automatische Abrufe ab (HTTP 401/403). |
| robots.txt untersagt | 1 | Pfad ist gesperrt. |

**Die 28 „kein Muster" sind der eigentliche Engpass, nicht die Sperren.** Große
Anbieter liefern heute eine leere Seite plus JavaScript; ohne einen echten
Browser sieht ein Abruf dort gar nichts. Genau dafür gibt es den
E-Mail-Suchauftrag: praktisch jedes dieser Portale verschickt neue Treffer per
Mail, wenn man dort eine gespeicherte Suche anlegt — und die App liest dieses
Postfach bereits aus. Für gesperrte und JavaScript-Portale ist das der Weg,
der funktioniert.

Konkret einsatzbereit:

| Quelle | Verfahren | Anmerkung |
| --- | --- | --- |
| Kleinanzeigen | eigener Adapter | Ergebnisliste direkt lesbar. Einschränkungen unten. |
| WG-Gesucht | eigener Adapter | Such-URL aus dem Browser einmalig einfügen. |
| Telegram (öffentliche Kanäle) | eigener Adapter | Ohne Konto lesbar, siehe unten. |
| Immowelt | Linkliste | `/expose/`-Links; Details kommen von der Anzeigenseite. |
| immobilo, Mr. Lodge | Linkliste | dito. |
| degewo, Gewobag (Berlin) | Linkliste | Kommunale Gesellschaften. |
| GdW | Feed | Verbandsseite — Rechercheeinstieg zu Genossenschaften, keine Anzeigenquelle. |
| ImmoScout24 | — | HTTP 401. E-Mail-Suchauftrag. |
| Immonet, immobilien.de, wohnungsboerse, markt.de, SAGA, ABG | — | HTTP 403. E-Mail-Suchauftrag. |

Ein Portal, das automatische Abrufe sperrt, wird nicht umgangen — es wird als
`BLOCKED` protokolliert und in der App auch so angezeigt, damit eine leere
Liste nie mit „kein Angebot" verwechselt wird.

## Telegram

Ein spürbarer Teil des Marktes — möblierte Wohnungen, Zwischenmieten,
Nachmieter — läuft nur über Telegram und ist binnen Stunden weg.

Gelesen wird die **öffentliche Web-Ansicht** eines Kanals (`t.me/s/NAME`), die
Telegram für jeden veröffentlicht. **Kein Konto, keine Anmeldung, kein
API-Schlüssel, kein Beitritt, keine gesendete Nachricht.** In den Einstellungen
werden nur die Kanalnamen eingetragen.

Grenzen, damit die Erwartung stimmt:

- **Nur öffentliche Kanäle.** Private Gruppen und Einladungslinks sind so nicht
  lesbar. Dafür bräuchte es ein echtes Telegram-Konto samt MTProto-Zugangsdaten
  — eine eigene Entscheidung mit eigenen Risiken, bewusst nicht gebaut.
- **Freitext.** Ein Kanalbeitrag hat kein Preisfeld. Alles kommt aus dem
  deutschen Parser; ein nachlässig geschriebener Beitrag ergibt eine dünne
  Anzeige.
- **Gesuche werden aussortiert.** Die Hälfte solcher Beiträge sind Leute, die
  selbst suchen. Die kommen nicht in den Bestand.

Kanäle findet man in Telegram über „Wohnung <Stadt>", „WG <Stadt>",
„Zwischenmiete <Stadt>"; ob ein Kanal öffentlich ist, zeigt ein Blick auf
`t.me/s/NAME` im Browser.

## Eine beliebige Seite hinzufügen

Unter „Einstellungen → Quelle hinzufügen" genügt die Adresse der
Ergebnisliste. Die App ruft die Seite ab, prüft robots.txt, sucht nach Feed,
schema.org-Daten, Sitemap und wiederkehrenden Link-Mustern und schlägt eine
fertige Konfiguration vor — samt Angabe, worauf sie beruht.

Findet sie nichts, sagt sie das ebenfalls, statt eine Quelle anzulegen, die
für immer stillschweigend nichts liefert.

## Wie oft geprüft wird

Pro Quelle einstellbar, weil sich Quellen sehr unterschiedlich schnell
bewegen: ein Marktplatz, auf dem eine gute Wohnung binnen einer Stunde weg ist,
verdient alle 10–15 Minuten eine Anfrage; ein kommunaler Vermieter, der
zweimal im Monat etwas einstellt, nicht — und ihn trotzdem im Minutentakt zu
fragen, verbraucht genau das Anfrage-Budget, das der schnelle braucht.

Der globale Mindestabstand bremst nur bis zur schnellsten eingestellten
Quelle, sonst wäre die Einstellung Dekoration. Für echten Minutentakt ruft ein
Cron `POST /api/discovery/run` alle paar Minuten auf; jede Quelle kommt dann
gemäß ihrem eigenen Abstand dran.

## Was aussortiert wird

Die generischen Verfahren erkaufen Breite mit Unschärfe. Auf einen
Vermieter-Auftritt angesetzt liefert eine Linkliste auch die Navigation mit —
ein Lauf gegen Gewobag brachte „Lagerraum", „Gewerberäume", „E-Stellplatz" und
„Immobilien Archiv" neben den echten Wohnungen zurück.

Deshalb muss ein Treffer eine niedrige Hürde nehmen, bevor er in den Bestand
kommt: nichts, was erkennbar **kein** Wohnraum ist, und mindestens ein
positives Signal dafür, dass es einer ist — eine Zimmerzahl, eine Fläche, eine
Miete, ein Wort wie „Wohnung", oder eine Adresse, die strukturell eine
Anzeigenseite ist (`/expose/…`). Die Hürde ist bewusst niedrig: eine dünne,
aber echte Anzeige muss durchkommen, denn eine verpasste Wohnung kostet mehr
als eine überflüssige Zeile.

## Kleinanzeigen: was die robots.txt erlaubt

Die robots.txt von kleinanzeigen.de wurde gelesen und wird eingehalten. Sie
verbietet ausgerechnet das, wonach man zuerst greifen würde:

- **Preisfilter** (`preis::900`) — gesperrt
- **Angebotsfilter** (`anzeige:angebote`) — gesperrt
- **Umkreissuche** (`…l9228r20`) — gesperrt
- **Ortssuche** (`/s-ort-empfehlungen.json`) — gesperrt

Erlaubt sind die einfache Ortsliste (`/s-wohnung-mieten/<ort>/c203l<id>`), deren
`seite:N`-Blättern und alle `/s-anzeige/…`-Detailseiten.

Daraus folgt, wie der Adapter arbeitet:

1. **Gefiltert wird bei uns, nicht dort.** Die App liest die ungefilterte
   Ortsliste und wendet Budget und Zimmerzahl im eigenen Ranking an. Das kostet
   etwas mehr Auswertung und liefert eher *mehr* Treffer als weniger.
2. **Mehrere Orte statt Umkreis.** Weil die Umkreissuche gesperrt ist, trägt
   man in den Einstellungen mehrere `locationIds` ein — Heilbronn plus die
   Nachbarorte. Das ist der erlaubte Ersatz für einen Radius.
3. **Die Ortsnummer ist Konfiguration.** Da die Ortssuche gesperrt ist, wird sie
   nicht geraten: eine falsche Nummer liefert stillschweigend die Wohnungen
   einer anderen Stadt. Stattdessen fügt man einmal eine Such-URL aus dem
   Browser ein, und die Nummer wird daraus gelesen (`…/c203l9228` → `9228`).

Nebenbei: dieselbe erlaubte URL liefert bei einem JSON-freundlichen
`Accept`-Header eine strukturierte Antwort statt HTML. Die wird bevorzugt — sie
ist stabiler als Markup und benennt sogar selbst, ob der Preis Kalt- oder
Warmmiete ist. Der HTML-Parser bleibt als Rückfallebene bestehen.

## Verfahren (Adapter)

| Schlüssel | Braucht | Wofür |
| --- | --- | --- |
| `kleinanzeigen` | `locationIds` | Kleinanzeigen, siehe oben. |
| `wggesucht` | `searchUrl` | WG-Gesucht. Keine öffentliche Ortssuche, daher Such-URL einfügen. |
| `feed` | `feedUrl` | RSS/Atom. Viele kommunale Wohnungsunternehmen und Genossenschaften — die verlässlichste Quelle überhaupt. |
| `jsonld` | `searchUrlTemplate` | Seiten mit schema.org-Daten (die meisten modernen Makler-CMS). |
| `linklist` | `searchUrlTemplate`, `linkPattern` | Seiten ohne alles: Links einsammeln, Details von der Anzeigenseite holen. |
| `sitemap` | `sitemapUrl` | Anbieter ohne Suchfunktion. |

Die vier generischen Verfahren brauchen keinen Code pro Seite. Eine neue Quelle
ist ein Eintrag in den Einstellungen, kein Deployment — deshalb kann die
Abdeckung wachsen, ohne dass jemand etwas programmiert.

Platzhalter in `searchUrlTemplate`: `{city}` `{citySlug}` `{plz}` `{radius}`
`{maxRent}` `{minRooms}` `{minSqm}` `{page}`. Fehlt ein Wert, wird die URL
**nicht** aufgerufen — eine Suche mit einem literalen `{city}` würde entweder
404 liefern oder, schlimmer, bundesweite Ergebnisse.

## Wie höflich die App ist

Alles läuft über einen einzigen Ausgang (`src/server/crawler.ts`):

- **robots.txt** wird geholt, zwischengespeichert (6 h) und befolgt, inklusive
  `Allow`-Vorrang und `Crawl-delay`. Fehlt sie, gibt es keine Einschränkung —
  so ist der Standard definiert.
- **Ein Abruf zur Zeit pro Server**, mit einstellbarer Pause (Standard 4 s).
- **Obergrenzen** für Antwortgröße (1,5 MB), Weiterleitungen (4), Zeit (20 s)
  und Abrufe pro Lauf (Standard 120).
- **Ehrliche Kennung**: `FreseWohnungBot/1.0`, über `DISCOVERY_USER_AGENT`
  anpassbar. Kein getarnter Browser-User-Agent.
- **Kein Umgehen** von CAPTCHAs, Anmeldungen oder Bot-Erkennung. Eine Sperre
  wird protokolliert, nicht umgangen.
- **SSRF-Schutz** aus `safeFetch`: keine internen Adressen, jeder
  Weiterleitungsschritt wird geprüft.

## Wann eine Anzeige verschwindet

Das früheste Signal ist nicht der 404 — es ist, dass die Anzeige nicht mehr in
der Ergebnisliste ihrer Quelle steht. `missedSweeps` zählt das mit. Vier
Sicherungen verhindern, dass eine gute Wohnung fälschlich verschwindet:

1. Nur **erfolgreiche** Läufe zählen. Eine blockierte Quelle kann ihren eigenen
   Bestand nicht ausblenden.
2. Erst nach **mehreren** Läufen in Folge (Standard 2) wird ausgeblendet.
3. Verschwindet der **gesamte** Bestand einer Quelle auf einmal, passiert
   nichts — das heißt fast immer, dass sich die Seitenstruktur geändert hat.
   Die Quelle wird auf `ERROR` gesetzt.
4. Taucht die Anzeige wieder auf, wird ein systemseitiges Ausblenden
   **zurückgenommen**.

Wer bereits angeschrieben wurde, bleibt in jedem Fall sichtbar: das Gespräch
überlebt die Anzeige.

## Auslöser

- **Beim Öffnen der Ergebnisseite** — gedrosselt über `sweepIntervalMinutes`
  (Standard 90), damit häufiges Aufrufen nichts auslöst.
- **Per Cron** auf `POST /api/discovery/run` mit `x-ingest-token`. Das hält den
  Bestand nachts und am Wochenende frisch, also genau dann, wenn gute Wohnungen
  auftauchen und wieder weg sind.
- **Von Hand** über „Jetzt suchen" — auf der Ergebnisseite und in den
  Einstellungen.

## Zusehen, während gesucht wird

Ein vollständiger Lauf dauert ein bis drei Minuten. Solange nichts auf dem
Bildschirm passierte, sah das aus wie ein Fehler und nicht wie Gründlichkeit.

`POST /api/discovery/live` führt denselben Lauf aus und schreibt dabei jedes
Ereignis sofort heraus — ein JSON-Objekt pro Zeile (NDJSON): welche Quelle
gerade gefragt wird, jede gefundene Wohnung, das Nachlesen der Detailseiten,
die Schlussbilanz. `LiveSearch` liest den Strom und füllt die Seite Wohnung für
Wohnung. Ohne `?force=1` prüft die Route erst die Drosselung und antwortet mit
einer einzigen `skipped`-Zeile, statt einen Strom zu öffnen, der sofort endet.

Zwei Dinge machen den Lauf zusätzlich kürzer:

- **Vier Quellen gleichzeitig.** Die Höflichkeitsregeln gelten pro Server und
  stecken im Crawler, deshalb kostet das keine Quelle etwas.
- **Detailseiten ebenso**, mit derselben Grenze.

Der Anfrage-Etat gilt weiterhin für den ganzen Lauf gemeinsam; deshalb vier und
nicht zwölf — sonst gäben die schnellen Quellen alles aus, bevor die langsamen
an der Reihe sind.

## Wenn nichts gefunden wird

Die Antwort steht in den Einstellungen unter „Letzte Suchläufe" — pro Quelle
mit Status und Begründung. Die drei häufigsten Fälle:

- `SKIPPED`: Konfiguration unvollständig (z. B. keine `locationIds`).
- `BLOCKED`: Das Portal sperrt automatische Abrufe. Erwartet bei ImmoScout24
  und Immowelt; dort hilft der E-Mail-Suchauftrag.
- `ERROR` mit Hinweis auf die Seitenstruktur: Die Quelle hat ihr Markup
  geändert und der Adapter braucht eine Anpassung.

Findet die Suche, aber passt nichts zum Profil, ist das eine andere Frage — die
beantwortet „Suchkriterien durchspielen" auf der Ergebnisseite.
