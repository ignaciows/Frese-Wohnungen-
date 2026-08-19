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
der Grund, warum es heute genau **eine** Quelle mit automatischem Suchlauf gibt:

| Ergebnis | Anzahl | Bedeutung |
| --- | --- | --- |
| automatisch lesbar | 8 | Ergebnisliste per Abruf lesbar. |
| kein Muster erkennbar | 28 | Die Seite baut ihre Ergebnisliste erst im Browser zusammen (JavaScript). Per Abruf ist dort nichts zu sehen. |
| blockiert | 7 | Das Portal weist automatische Abrufe ab (HTTP 401/403). |
| robots.txt untersagt | 1 | Pfad ist gesperrt. |

**Die 28 „kein Muster" sind der eigentliche Engpass, nicht die Sperren.** Große
Anbieter liefern heute eine leere Seite plus JavaScript; ohne einen echten
Browser sieht ein Abruf dort gar nichts. Und von den acht lesbaren waren sieben
kommunale Anbieter mit einer Handvoll Wohnungen im Monat — Aufwand ohne Ertrag.

Genau dafür gibt es den E-Mail-Suchauftrag: praktisch jedes gesperrte oder
JavaScript-Portal verschickt neue Treffer selbst per Mail, wenn man dort eine
Suche speichert. Die App liest dieses Postfach aus. Das ist der Weg, der
funktioniert.

Übrig bleibt:

| Quelle | Weg | Anmerkung |
| --- | --- | --- |
| Kleinanzeigen | eigener Adapter | Ergebnisliste direkt lesbar. Einschränkungen unten. |
| ImmoScout24 | E-Mail-Suchauftrag | HTTP 401 auf jeder Listenseite. |
| Immowelt | **Suchlauf** | Trefferliste lesbar und in der robots.txt nicht gesperrt; die Exposé-Seiten dahinter antworten mit 403, also ohne Nachlesen und ohne Telefonnummer. |

Einrichtung der beiden E-Mail-Portale: `docs/QUELLEN.md`. Wie die Mails gelesen
werden: `docs/EMAIL_INGEST.md`.

Ein Portal, das automatische Abrufe sperrt, wird nicht umgangen — es wird als
`BLOCKED` protokolliert und in der App auch so angezeigt, damit eine leere
Liste nie mit „kein Angebot" verwechselt wird.

## Wie oft geprüft wird

Auf Kleinanzeigen ist eine gute Wohnung binnen einer Stunde weg, deshalb
verdient die Quelle alle 10–15 Minuten eine Anfrage. Der Abstand ist pro Quelle
einstellbar (Einstellungen → Quellen → Technische Einstellungen); der globale
Mindestabstand bremst nur bis zur schnellsten eingestellten Quelle, sonst wäre
die Einstellung Dekoration.

Für echten Minutentakt ruft ein Cron `POST /api/discovery/run` alle paar Minuten
auf; jede Quelle kommt dann gemäß ihrem eigenen Abstand dran.

## Was aussortiert wird

Eine Ergebnisliste enthält nicht nur Wohnungen. Kleinanzeigen mischt Garagen,
Stellplätze, Gewerbe und Monteurzimmer darunter, und frühere Läufe gegen
Vermieter-Auftritte haben sogar deren Navigation eingesammelt — „Lagerraum",
„Gewerberäume", „Immobilien Archiv" neben den echten Wohnungen.

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
3. **Die Ortsnummer wird nicht geraten.** Eine falsche Nummer liefert
   stillschweigend die Wohnungen einer anderen Stadt. Der Adapter liest sie
   stattdessen aus der Regionsnavigation des Portals — derselben Liste, die ein
   Mensch dort anklicken würde (`…/c203l9228` → `9228`). Wer sie lieber fest
   vorgibt, trägt sie unter „Technische Einstellungen" als `locationIds` ein.

Nebenbei: dieselbe erlaubte URL liefert bei einem JSON-freundlichen
`Accept`-Header eine strukturierte Antwort statt HTML. Die wird bevorzugt — sie
ist stabiler als Markup und benennt sogar selbst, ob der Preis Kalt- oder
Warmmiete ist. Der HTML-Parser bleibt als Rückfallebene bestehen.

## Verfahren (Adapter)

Genau eines, in `src/domain/discovery/registry.ts`:

| Schlüssel | Braucht | Wofür |
| --- | --- | --- |
| `kleinanzeigen` | nichts | Ortsnummern liest der Adapter selbst aus der Regionsnavigation des Portals. |

Es gab einmal vier generische Verfahren (RSS-Feed, schema.org, Linkliste,
Sitemap), Adapter für WG-Gesucht und Telegram, und eine Oberfläche, die eine
beliebige Website ausprobiert und ein passendes Verfahren vorschlägt. Gut
gedacht — in der Praxis hat es Anzeigen geliefert, die nie jemand angeschrieben
hat, und dabei das Anfrage-Budget der einen Quelle verbraucht, die etwas
bringt. Alles entfernt; es steht in der Git-Historie, falls die Rechnung eines
Tages anders aussieht.

Was davon bleibt und sich lohnt: **das Lesen der Detailseite**
(`src/domain/discovery/detail.ts`). Es ist nicht seitenspezifisch — es liest die
schema.org-Auszeichnung, die die meisten Immobilien-CMS für Google einbauen,
sonst die Open-Graph-Tags, sonst den Seitentext. Daher kommen Nebenkosten,
„frei ab" und die Telefonnummer (siehe `docs/KONTAKT.md`).

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
- **Einmal täglich je Kandidat**, und zwar auch dann, wenn die Drossel gerade
  „nein" sagen würde. Der Suchlauf ist gemeinsam — fünf Pflegekräfte in
  derselben Stadt ergeben eine Suche —, also sagt „vor einer halben Stunde
  gelaufen" nichts darüber aus, ob dabei nach *dieser* Kandidatin gesucht
  wurde. `CandidateCase.lastSweptAt` beantwortet genau das: die erste Öffnung
  des Falls an einem Tag sucht, die vierte tut nichts.
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

Die Detailseiten werden dabei zu viert gleichzeitig gelesen. Die
Höflichkeitsregeln gelten pro Server und stecken im Crawler, deshalb kostet das
niemanden etwas — der Anfrage-Etat gilt weiterhin für den ganzen Lauf
gemeinsam.

## Wenn nichts gefunden wird

Die Antwort steht in den Einstellungen unter „Letzte Suchläufe" — pro Quelle
mit Status und Begründung. Die drei häufigsten Fälle:

- `SKIPPED`: Quelle ausgeschaltet oder Konfiguration unvollständig.
- `BLOCKED`: Das Portal sperrt automatische Abrufe. Erwartet bei ImmoScout24
  ImmoScout24; dort hilft der E-Mail-Suchauftrag.
- `ERROR` mit Hinweis auf die Seitenstruktur: Die Quelle hat ihr Markup
  geändert und der Adapter braucht eine Anpassung.

Findet die Suche, aber passt nichts zum Profil, ist das eine andere Frage — die
beantwortet „Suchkriterien durchspielen" auf der Ergebnisseite.
