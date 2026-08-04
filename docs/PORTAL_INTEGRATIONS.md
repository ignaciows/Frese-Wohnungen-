# Portal Integrations

**Grundregel:** Kein Portal wird ohne Prüfung der aktuellen offiziellen Terms
automatisiert angesprochen. Alle Quellen im Auslieferungszustand stehen auf
`termsReviewStatus = MANUAL_ONLY`. Freischaltung erfolgt pro Quelle durch die
Admin-Rolle, dokumentiert mit Datum + URL der geprüften Nutzungsbedingungen.

## Priorisierte Integrationsreihenfolge (verbindlich)

1. Offizielle API mit passender kommerzieller Berechtigung.
2. Freigegebene Partner-/Feed-Integration.
3. Nutzer-autorisierte E-Mail-Alerts (OAuth an Gmail / Microsoft).
4. Validierte Such-URL + manueller Browser-Flow.
5. Manueller URL-/Text-Import.

## Verbotenes Verhalten

- CAPTCHA-Umgehung, Bot-Detection-Umgehung, Login-Umgehung.
- Rate-Limit-Umgehung, Proxy-Rotation, Stealth-Browser.
- Reverse Engineering privater APIs.
- Scrapen geschlossener Facebook-Gruppen, Weiterverarbeitung privater
  Nachrichten.
- Speichern von Portal-Passwörtern.
- Massen-Anfragen.
- Mock-Daten als „echte" Portal-Ergebnisse ausgeben.
- Compliance behaupten ohne aktuelle Terms geprüft zu haben.

## Umsetzung im MVP (Stand 2026-08-04)

Alle unten aufgeführten Quellen sind im Katalog als `SEARCH_LINK`,
`BROWSER_ONLY` oder `REGIONAL_DIRECTORY` konfiguriert. **Keiner** der Konnektoren
ruft im Auslieferungszustand echte Portal-Daten ab. Manueller Import und
generierte Such-Links sind für alle verfügbar.

| Quelle             | Familie          | Modus (aktuell) | Terms geprüft | Bemerkung / erforderliche Freigabe für Automatisierung                                                                 |
| ------------------ | ---------------- | --------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| ImmoScout24        | immoscout        | SEARCH_LINK     | offen         | Business-Vertrag + Content-API-Freigabe erforderlich. Ohne diesen: nur Such-Link + manueller Import.                   |
| Immowelt           | immowelt         | SEARCH_LINK     | offen         | Immonet gehört heute zur Immowelt-Familie — als Alias geführt. API nur mit Business-Vertrag.                          |
| Kleinanzeigen      | kleinanzeigen    | SEARCH_LINK     | offen         | Keine öffentliche Miet-API. Scraping durch ToS untersagt. Ausschließlich Such-Link + manueller Import.                 |
| WG-Gesucht         | wggesucht        | SEARCH_LINK     | offen         | Für Wohnungen (keine WG-Zimmer) — Filter dokumentiert im manuellen Rezept.                                             |
| meinestadt.de      | —                | SEARCH_LINK     | offen         | Regionaler Aggregator. Kein API-Zugang bekannt.                                                                       |
| ohne-makler.net    | —                | SEARCH_LINK     | offen         | Kein öffentlicher API-Zugang.                                                                                          |
| immobilo           | —                | SEARCH_LINK     | offen         | Kein öffentlicher API-Zugang.                                                                                          |
| Wohnungsbörse      | —                | SEARCH_LINK     | offen         | Kein öffentlicher API-Zugang.                                                                                          |
| Wunderflats        | wunderflats      | SEARCH_LINK     | offen         | Kein bekannter Partnerkanal für interne Recherche. Manuell + Such-Link.                                                |
| HousingAnywhere    | housinganywhere  | SEARCH_LINK     | offen         | Nachfolger für einige Studenten-WG-Angebote (Alias vermerkt). API nur für Partner.                                    |
| Spotahome          | —                | SEARCH_LINK     | offen         | —                                                                                                                      |
| HC24               | —                | SEARCH_LINK     | offen         | —                                                                                                                      |
| Mr. Lodge          | —                | SEARCH_LINK     | offen         | Regional (München / Bayern).                                                                                          |
| Vonovia            | —                | SEARCH_LINK     | offen         | Bundesweiter Institutional Landlord. Eigenes Portal, keine öffentliche API.                                            |
| LEG Wohnen         | —                | SEARCH_LINK     | offen         | Schwerpunkt NRW.                                                                                                       |
| TAG Wohnen         | —                | SEARCH_LINK     | offen         | Bundesweit.                                                                                                            |
| Wohnraum BW        | —                | REGIONAL_DIRECTORY | offen      | Sammel-Directory. Nur Einstiegspunkt, konkrete Vermieter darunter einzeln.                                             |
| Stadt Bad Rappenau | —                | BROWSER_ONLY    | —             | Städtischer Hinweisdienst. Rein manuell.                                                                              |
| Stadtsiedlung Heilbronn | —           | SEARCH_LINK     | offen         | Kommunales Wohnungsunternehmen.                                                                                       |
| Heilbronner Stimme | —                | SEARCH_LINK     | offen         | Regionaler Immobilienmarkt.                                                                                            |
| nebenan.de         | —                | BROWSER_ONLY    | —             | Nur mit ausdrücklicher Zustimmung. Kein Posting durch die App.                                                        |
| Monteurzimmer.de   | —                | SEARCH_LINK     | offen         | **Nur Notfall-Modus**. Anmeldung & Wohnungsgeberbestätigung explizit prüfen.                                          |
| Booking.com (extended stays) | —      | BROWSER_ONLY    | —             | **Nur Notfall-Modus**. Anmeldung meist NICHT möglich — bei jeder Buchung klarstellen.                                 |

## Was ist umgesetzt vs. geplant

- **Umgesetzt**: Quellenkatalog, Filter-Mapping pro Quelle, Rezept-Generator,
  Such-URL-Template-Slot (nur genutzt wenn `searchUrlValidated = true`),
  manueller Import mit URL-Normalisierung, DB-Snapshot pro Suchlauf.
- **Geplant (nicht V1)**: OAuth-Empfang von E-Mail-Alerts, ImmoScout24
  Business-API-Client, Browser-Companion für 1-Klick-Import.
- **Bewusst nicht geplant**: Scraper, Headless-Browser-Automation, JavaScript-
  Reverse-Engineering von Portalen.

## Freischaltung einer Quelle für Automatisierung

1. Aktuelle Terms des Anbieters lesen und Datum + URL notieren.
2. Falls ein kommerzieller Vertrag vorhanden ist: `termsReviewStatus`
   auf `APPROVED_FOR_AUTOMATION` und `termsReviewedAt` setzen.
3. Konnektor-Code hinzufügen, `integrationMode` auf `OFFICIAL_API` /
   `EMAIL_ALERT` setzen, `connectorStatus` auf `AVAILABLE`.
4. Bei Ausfall automatisch `connectorStatus = UNHEALTHY` — die App fällt dann
   auf den manuellen Flow zurück.

Bis Schritt 3 erledigt ist, gilt: **Such-Link + manueller Import.**
