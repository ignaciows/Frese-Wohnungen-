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

| Quelle | Automatisch lesbar | Anmerkung |
| --- | --- | --- |
| Kleinanzeigen | **ja** | Ergebnisliste wird direkt gelesen. Einschränkungen unten. |
| WG-Gesucht | **ja** | Braucht einmalig die Such-URL aus dem Browser. |
| ImmoScout24 | nein | Antwortet serverseitigen Abrufen mit HTTP 401. Bleibt beim E-Mail-Suchauftrag. |
| Immowelt / Immonet | nein | Antwortet mit HTTP 403. Bleibt beim E-Mail-Suchauftrag. |
| beliebige weitere | **ja, per Konfiguration** | Über die generischen Verfahren, siehe unten. |

Geprüft am 2026-08-10 gegen die Live-Seiten. Ein Portal, das automatische
Abrufe sperrt, wird nicht umgangen — es wird als `BLOCKED` protokolliert und in
der App auch so angezeigt, damit eine leere Liste nie mit „kein Angebot"
verwechselt wird.

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

- **Beim Öffnen der App** — gedrosselt über `sweepIntervalMinutes` (Standard
  90), damit häufiges Aufrufen nichts auslöst.
- **Per Cron** auf `POST /api/discovery/run` mit `x-ingest-token`. Das hält den
  Bestand nachts und am Wochenende frisch, also genau dann, wenn gute Wohnungen
  auftauchen und wieder weg sind.
- **Von Hand** über „Jetzt suchen" in den Einstellungen.

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
