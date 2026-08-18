# Kontaktdaten aus der Anzeige

## Warum das die wichtigste Zahl auf dem Bildschirm ist

Eine Anfrage über das Portalformular landet in einem Postfach mit vierzig
anderen und wird am Donnerstag beantwortet. Ein Anruf wird in zehn Minuten
beantwortet. Bei den Wohnungen, die es wert sind, ist das der ganze Unterschied.

Viele private Vermieter schreiben ihre Nummer in den Anzeigentext — „Tel. 0176 /
1234567", „Bitte nur per WhatsApp", „Rückruf unter 07131-98765". Gelesen hat das
niemand: wer die Liste abgearbeitet hat, musste jede Anzeige einzeln öffnen und
nachsehen. Jetzt liest der Parser das einmal, und das Ergebnis steht auf der
Karte.

## Was gefunden wird

`src/domain/contact/index.ts` liest aus Titel + Beschreibung:

| Feld | Beispiel im Text | Was gespeichert wird |
| --- | --- | --- |
| `contactPhone` | `Tel. 0176 / 1234567` | `+49 176 1234567` |
| `contactEmail` | `wohnung@hausverwaltung.de` | kleingeschrieben |
| `contactName` | `Ansprechpartner: Herr Weber` | `Herr Weber` |

Alle drei sind optional. Leer ist ein völlig normaler Zustand und heißt: diese
Anzeige wird über das Formular des Portals beantwortet.

### Telefonnummern

Erkannt werden die Schreibweisen, die in echten Anzeigen vorkommen: `+49 …`,
`0049 …`, `0176 12345678`, `0176/1234567`, `0176-1234 5678`, `(07131) 123456`,
`07131 12 34 56`. Steht ein Wort wie „Tel.", „Handy", „WhatsApp" oder „Rückruf"
davor, gewinnt diese Nummer gegen eine andere weiter unten im Text.

Gespeichert wird immer eine Form: `+49 <Vorwahl> <Rest>`. Das ist nicht Kosmetik
— so lässt sich dieselbe Nummer in zwei Anzeigen wiedererkennen, und die UI kann
daraus ohne Nachdenken einen `tel:`-Link bauen.

**Was ausdrücklich nicht als Nummer durchgeht:** Preise (`1.250,00 €`), Flächen
(`65 m²`), Postleitzahlen (`74072`), Daten (`01.09.2026`), Anzeigen-IDs
(`3123456789`), IBANs, sowie Platzhalter wie `0000000000`. Die Regeln dafür:

- muss mit `+49`, `0049` oder `0` beginnen,
- 10 bis 13 Ziffern insgesamt,
- darf nichts enthalten, was wie ein Datum aussieht.

**Lieber nichts als falsch.** Eine erfundene Nummer kostet eine Kollegin einen
Anruf bei einem Fremden — das ist deutlich schlimmer als ein leeres Feld.

## Wo es herkommt

Alle drei Wege ins Programm laufen durch `ingestListing`
(`src/server/listingIngest.ts`), und genau dort wird gelesen. Deshalb bekommen
alle drei Wege Telefonnummern, nicht nur der, an den jemand gedacht hat:

| Weg | Textquelle |
| --- | --- |
| Kleinanzeigen-Suchlauf | Ergebnisliste, danach die Detailseite |
| Suchauftrag-Mail (ImmoScout24, Immowelt) | der Textblock der Anzeige in der Mail |
| Manuell eingefügt | was die Kollegin einfügt |

Zwei Regeln dabei:

- **Was die Quelle selbst weiß, gewinnt.** Kleinanzeigen nennt den Verkäufer im
  eigenen Markup — das schlägt jedes Raten aus dem Fließtext.
- **Eine Nummer, die wir einmal hatten, geht nie verloren.** Portale blenden die
  Nummer wieder aus, sobald eine Anzeige beliebt wird. Ein späterer Durchlauf
  ohne Nummer überschreibt die alte deshalb nicht.

## Wo es auf dem Bildschirm auftaucht

- **Ergebnisliste:** die ganze Zeile bekommt einen grünen Rand und ein leichtes
  Leuchten, die Nummer steht als Badge mit dabei (`☎ +49 176 12345678 · Herr
  Weber`), und rechts sitzt ein grüner **Anrufen**-Knopf, der direkt wählt.

  Bewusst die ganze Zeile und nicht nur ein Symbol: ein Zeichen unter zwanzig
  anderen liest niemand. Das hier ist die Zeile, die man von der ganzen Liste
  zuerst anfassen sollte, und so sieht sie auch aus. Wer „Bewegung reduzieren"
  eingestellt hat, bekommt die Farbe ohne das Leuchten.
- **Detailbereich rechts:** ganz oben, über allem anderen, ein Anruf-Knopf mit
  der Nummer und — falls bekannt — dem Namen. Danach unten „Kontakt bestätigen",
  dann laufen Verlauf und Wiedervorlage genauso wie bei einer gesendeten
  Anfrage.
- **E-Mail-Adresse plus eingerichteter Versand:** die Anfrage geht direkt aus
  der App raus, ohne Portal-Tab.

## Datenschutz

Gelesen wird ausschließlich, was die Anzeige selbst veröffentlicht. Es wird
nichts nachgeschlagen, nichts hinter einer Anmeldung geholt und nichts geraten.
Wird eine Anzeige gelöscht, verschwindet die Zeile mit ihren Kontaktdaten wie
jede andere auch. Siehe `docs/PRIVACY_AND_SECURITY.md`.

## Wenn du daran arbeitest

- Die Regeln stehen in `src/domain/contact/index.ts` — reine Funktionen, kein
  Prisma, kein Netz.
- Die Tests in `tests/contact.test.ts` (Lesen) und `tests/contactIngest.test.ts`
  (Verdrahtung bis in die Datenbank).
- Eine neue Schreibweise ergänzt man in `PHONE_CANDIDATE` oder
  `PHONE_KEYWORDS` — **und immer zusammen mit einem Fall in der
  „erfindet keine Nummern"-Tabelle**, sonst ist die nächste Falschmeldung
  vorprogrammiert.
