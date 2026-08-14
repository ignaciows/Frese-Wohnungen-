# Die drei Quellen

Praktisch jede Wohnung, die dieses Werkzeug findet, kommt von Kleinanzeigen,
ImmoScout24 oder Immowelt. Vierzig kommunale Vermieter im Katalog kosten
Anfrage-Budget und liefern eine Handvoll Anzeigen im Monat. Deshalb: **diese
drei richtig, der Rest optional.**

In den Einstellungen unter „Quellen" gibt es dafür den Knopf **„Nur die drei
Hauptquellen"** — er schaltet die drei ein und alle anderen aus. Nichts wird
gelöscht; jede Quelle lässt sich einzeln wieder einschalten.

## Warum die drei sich unterschiedlich verhalten

|  | Kleinanzeigen | ImmoScout24 | Immowelt |
| --- | --- | --- | --- |
| Automatisch lesbar | **ja** | nein | nein |
| Öffentliche API | nein | nein (nur Partner) | nein (nur Partner) |
| Weg in die App | Suchlauf | **Suchauftrag per E-Mail** | **Suchauftrag per E-Mail** |
| Beschreibung & „frei ab" | aus der Detailseite | aus der Mail | aus der Mail |

### Kleinanzeigen

Läuft von selbst. Die robots.txt erlaubt die Ergebnislisten, der Adapter liest
sie, und die Detailseiten füllen Nebenkosten, Verfügbarkeit und Kontakt nach.
Ein Portal-Zugang wird nur zum **Antworten** gebraucht (Einstellungen → Konten).

### ImmoScout24 und Immowelt

Beide sperren automatische Abrufe: ImmoScout24 antwortet auf Listenseiten mit
einer Bot-Sperre, Immowelts Exposé-Seiten sind für uns nicht lesbar (403, Inhalt
per JavaScript). Eine API gibt es nur für Vertragspartner — kein
Entwicklerkonto, das man sich selbst anlegen kann. Wer behauptet, das ginge
„mit einem Schlüssel", meint das Partnerprogramm.

**Der Weg, der funktioniert und erlaubt ist: der Suchauftrag.** Beide Portale
schicken neue Treffer selbst per Mail. Die App liest dieses Postfach und legt
daraus Anzeigen an — inklusive Beschreibung, Preis und Verfügbarkeit, also
genau der Daten, die beim Auslesen fehlen.

#### Einrichtung, einmal pro Portal und Stadt

1. **Postfach anlegen** — eine eigene Adresse, z. B. `wohnungen@…`. Nicht das
   normale Firmenpostfach: die Portale schicken täglich mehrere Mails.
2. In den Einstellungen unter **Konten & Postfach** IMAP/SMTP hinterlegen und
   mit „Verbindung testen" prüfen. Details in `docs/EMAIL_INGEST.md`.
3. Im Portal **anmelden** (der Zugang gehört unter Einstellungen → Konten) und
   eine Suche anlegen mit: Ort, Umkreis, Warmmiete-Obergrenze, Mindestzimmer.
4. Diese Suche als **Suchauftrag speichern**, Benachrichtigung **täglich** (bei
   ImmoScout24: „Sofort" liefert schneller, aber deutlich mehr Mails), Empfänger
   ist das Postfach aus Schritt 1.
5. Fertig. Der Abruf des Postfachs läuft mit dem normalen Suchlauf mit; unter
   Einstellungen → „Suchagent-Postfach" steht, wann zuletzt gelesen wurde und
   was dabei herauskam.

#### Was dabei zu beachten ist

- **Ein Suchauftrag pro Stadt**, nicht pro Kandidat. Mehrere Kandidaten in
  derselben Stadt teilen sich die Treffer; die Zuordnung macht die Bewertung.
- **Obergrenze großzügig setzen** (10–20 % über dem Budget): die Portale
  filtern auf die Kaltmiete, unser Limit ist die Warmmiete.
- **Keine Weiterleitung von einem anderen Postfach** — dabei geht der
  ursprüngliche Absender verloren, und die Zuordnung der Mail zum Portal auch.

## Woran man merkt, dass es läuft

- Einstellungen → **„Letzte Suchläufe"**: pro Quelle Status und Begründung.
  `BLOCKED` bei ImmoScout24/Immowelt ist zu erwarten, solange dort ein
  Suchlauf-Adapter aktiv ist — deshalb schaltet „Nur die drei Hauptquellen"
  genau die nicht ein.
- Einstellungen → **„Suchagent-Postfach"**: Zeitpunkt der letzten Abholung und
  die Anzahl der daraus erzeugten Anzeigen.
- Auf der Ergebnisseite steht an jeder Zeile, von welcher Quelle sie stammt.

## Was ausdrücklich nicht gemacht wird

Kein Umgehen von Bot-Sperren, keine getarnten User-Agents, keine gelösten
CAPTCHAs, kein Scraping hinter einer Anmeldung. Eine Sperre wird protokolliert,
nicht umgangen — siehe `docs/DISCOVERY.md`. Der Suchauftrag ist nicht der
Umweg, sondern der vom Portal selbst vorgesehene Weg.
