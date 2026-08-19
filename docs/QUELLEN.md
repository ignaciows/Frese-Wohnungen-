# Die drei Quellen

Praktisch jede Wohnung, die dieses Werkzeug findet, kommt von **Kleinanzeigen**,
**ImmoScout24** oder **Immowelt**. Der Katalog hatte einmal rund fünfzig
Einträge — kommunale Vermieter, Zwischenmiet-Portale, Verzeichnisse. Die haben
pro Suchlauf Anfragen verbraucht und im Monat eine Handvoll Anzeigen geliefert.
Deshalb gibt es jetzt nur noch diese drei, und die richtig.

## Zwei Wege, mehr gibt es nicht

|  | Kleinanzeigen | Immowelt | ImmoScout24 |
| --- | --- | --- | --- |
| Trefferliste lesbar | **ja** | **ja** | nein (HTTP 401) |
| Exposé-Seite lesbar | ja | nein (HTTP 403) | nein |
| Öffentliche API | nein | nur für Vertragspartner | nur für Vertragspartner |
| Weg in die App | **Suchlauf** | **Suchlauf** (+ Mail optional) | **Suchauftrag per E-Mail** |
| Woher Beschreibung & „frei ab" | aus der Detailseite | aus der Trefferliste | aus der Mail |
| Telefonnummer aus der Anzeige | ja | nein | aus der Mail, falls genannt |

Im Code heißt das `Source.route`: `DISCOVERY` oder `EMAIL_ALERT`. Eine dritte
Möglichkeit gibt es nicht, und alles im Programm hängt an diesen zwei Werten.

---

## Kleinanzeigen — läuft von selbst

Nichts einzurichten außer einem Schalter.

1. Einstellungen → **Quellen** → Kleinanzeigen einschalten. Speichert sofort.
2. Fertig. Der Suchlauf holt sich die Ortsnummern selbst aus der
   Regionsnavigation des Portals.

Die robots.txt sperrt die Preis-, Umkreis- und Angebotsfilter sowie die
Ortssuche. Deshalb liest die App die **ungefilterte Ortsliste** und filtert
selbst — mehrere Orte ersetzen den Umkreis. Ein Portal-Zugang wird nur zum
**Antworten** gebraucht (Einstellungen → Konten).

---

## Immowelt — läuft ebenfalls von selbst

Einstellungen → **Quellen** → Immowelt einschalten. Mehr nicht: die
Suchadresse holt sich der Adapter über Immowelts eigene Weiterleitung
(`/suche/heilbronn/wohnungen/mieten` landet auf der Suchseite mit Ortskennung),
also gibt es keinen Ortsnummern-Katalog, der veraltet.

Was dabei herauskommt: die **erste Seite**, rund 20–24 Anzeigen je Ort und
Durchlauf, mit Preis, Zimmern, Fläche, Straße, Postleitzahl und dem Anfang des
Anzeigentexts. Weitere Seiten lädt Immowelt per JavaScript nach; Seiten-
parameter liefern dieselben Anzeigen noch einmal (ausprobiert: `?sp=2`,
`?page=2`, `?pageIndex=2`, `/seite-2`).

Was **nicht** geht: die Exposé-Seiten antworten mit 403. Von dort kommt also
kein voller Anzeigentext und **keine Telefonnummer**. Wer die will, legt
zusätzlich einen Suchauftrag per E-Mail an — beides nebeneinander ist erlaubt
und stört sich nicht.

Die robots.txt von Immowelt sperrt `/suche/` nicht (gesperrt sind dort
Formulare, Karten, Druckansichten und ein paar Sonderpfade). Nachgeprüft, nicht
angenommen.

---

## ImmoScout24 — der Suchauftrag

ImmoScout24 antwortet einem Abruf ohne Browser mit `401 Ich bin kein Roboter` —
eine Schranke, keine Bitte, und um die geht dieses Programm nicht herum. Eine
API gibt es nur mit
Business-Vertrag — kein Entwicklerkonto, das man sich selbst anlegen kann. Wer
behauptet, das ginge „mit einem Schlüssel", meint das Partnerprogramm.

**Der Weg, der funktioniert und erlaubt ist: der Suchauftrag.** Das Portal
schickt neue Treffer selbst per Mail, an eine Adresse, die man ihm nennt. Die
App liest dieses Postfach und legt daraus Anzeigen an. Das ist kein Umweg um
eine Sperre, sondern der vom Portal selbst vorgesehene Weg — und die Mail
enthält mehr, als ein Suchlauf lesen könnte: Beschreibung, Preis, Größe,
Zimmerzahl, Stadtteil.

### Einrichtung — einmal pro Portal und Stadt

1. **Postfach anlegen.** Eine eigene Adresse, z. B. `wohnungen@…`. Nicht das
   normale Firmenpostfach: die Portale schicken täglich mehrere Mails.
2. **In der App hinterlegen.** Einstellungen → **Konten & Postfach** → IMAP/SMTP
   eintragen und mit „Verbindung testen" prüfen. Details in
   `docs/EMAIL_INGEST.md`.
3. **Im Portal anmelden** (der Zugang gehört unter Einstellungen → Konten) und
   eine Suche anlegen: Ort, Umkreis, Kaltmiete-Obergrenze, Mindestzimmer.
4. **Als Suchauftrag speichern.** Benachrichtigung täglich — bei ImmoScout24
   liefert „Sofort" schneller, aber deutlich mehr Mails. Empfänger ist das
   Postfach aus Schritt 1.
5. **Fertig.** Das Postfach wird mit jedem Suchlauf mitgelesen. Unter
   Einstellungen → „Suchagent-Postfach" steht, wann zuletzt abgeholt wurde und
   was dabei herauskam.

Dieselben vier Schritte stehen auch in der App selbst, unter
Einstellungen → Quellen bei jedem der beiden Portale.

### Einer Anzeige einen Kandidaten zuordnen

Der Empfänger im Suchauftrag entscheidet, bei wem die Treffer landen:

```
wohnungen+CAND-2026-014@firma.de
             └── Kennung des Kandidaten
```

Ohne Kennung weiß die App nicht, zu wem die Mail gehört, und protokolliert sie
als `UNKNOWN_CANDIDATE`.

### Worauf zu achten ist

- **Ein Suchauftrag pro Stadt**, nicht pro Kandidat. Mehrere Kandidaten in
  derselben Stadt teilen sich die Treffer; die Zuordnung macht die Bewertung.
- **Obergrenze großzügig setzen**, 10–20 % über dem Budget: die Portale filtern
  die **Kaltmiete**, unser Limit ist die **Warmmiete**.
- **Keine Weiterleitung aus einem anderen Postfach.** Dabei geht der
  ursprüngliche Absender verloren und damit die Zuordnung zum Portal.

---

## Woran man merkt, dass es läuft

- Einstellungen → **Letzte Suchläufe**: pro Quelle Status und Begründung.
- Einstellungen → **Suchagent-Postfach**: Zeitpunkt der letzten Abholung und
  wie viele Anzeigen daraus entstanden sind.
- Seite **Quellen**: pro Portal der Weg, die Zahl der Anzeigen und wann zuletzt
  gelesen wurde.
- Auf der Ergebnisseite steht an jeder Zeile, von welcher Quelle sie stammt.

## Was ausdrücklich nicht gemacht wird

Kein Umgehen von Bot-Sperren, keine getarnten User-Agents, keine gelösten
CAPTCHAs, kein Scraping hinter einer Anmeldung, keine Proxy-Rotation. Eine
Sperre wird protokolliert, nicht umgangen — siehe `docs/DISCOVERY.md`.

## Eine vierte Quelle hinzufügen

Kurz: nur, wenn sie wirklich liefert. Konkret:

1. Eintrag in `src/domain/sources/catalog.ts` ergänzen — `route` entscheidet
   alles Weitere.
2. Bei `EMAIL_ALERT`: das URL-Muster der Anzeigen in `LISTING_PATTERNS`
   (`src/domain/mail/index.ts`) ergänzen. Mehr braucht es nicht.
3. Bei `DISCOVERY`: einen Adapter unter `src/domain/discovery/adapters/`
   schreiben und in `registry.ts` eintragen. Vorher die robots.txt und die
   Nutzungsbedingungen der Seite prüfen — das ist kein Formalismus, davon hängt
   ab, ob die Quelle überhaupt betrieben werden darf.
4. Tests gegen ein gespeichertes Fixture, kein Netz (siehe
   `tests/discovery.test.ts`).
