# Product Brief — Frese Wohnung

## Wer nutzt es

Interne Kolleg:innen von Frese Recruiting GmbH. Normale Office-Anwender:innen,
kein Tech-Vorwissen. Zwei Rollen: `ADMIN` (kann Quellenkatalog verwalten) und
`COLLEAGUE` (Standard-Recherche und Kontaktfluss).

Kandidat:innen und Vermieter:innen greifen **nicht** auf die App zu.

## Welches Problem

Die manuelle Suche für internationale Pflegekräfte ist fragmentiert: viele
Portale, unterschiedliche Filter, unklar wer welche Anzeige schon gesehen oder
angeschrieben hat, wichtige Restriktionen (WBS, Tausch, Möblierung, echte
Warmmiete) verstecken sich im Fließtext.

Es gibt bereits ein separates Firmen-System, in das nach jedem Kontakt drei
Felder manuell übertragen werden: **Wohnung/Objekt**, **Link**, **Ort**. Frese
Wohnung ersetzt dieses System nicht und integriert es nicht per API — es
liefert die drei Felder auf Knopfdruck.

## Die tägliche Frage, die ein Bildschirm beantworten soll

> Welche Wohnung sollte ich als nächstes kontaktieren, warum ist sie eine gute
> Option, hat schon jemand aus dem Team daran gearbeitet, und was muss ich nach
> dem Kontakt kopieren?

## Nutzerreise (MVP)

1. **Kandidatenfall** wählen oder anlegen (nur pseudonyme Referenz + Suche-
   relevante Felder — keine Ausweise, keine medizinischen Unterlagen).
2. **Anschreiben** in großes Textfeld einfügen (wird 1:1 gespeichert und in
   jeden Kontaktversuch als Snapshot übernommen).
3. **Suchprofil** setzen: Arbeitsort, max. Warmmiete (Standard 900 €), Zimmer,
   Möblierungs-Wunsch, max. Anfahrt, WBS-Status, Notfall-Modus.
4. **Suchlauf** starten. Der Planer erzeugt einen SourceCheck pro relevante
   Quelle — auch für Quellen ohne Konnektor. Manuell heißt: Portal öffnen,
   Rezept ansehen, danach „Nichts gefunden" oder „Erledigt" markieren.
5. **Anzeigen importieren** — per Formular oder aus der Checkliste. Der
   deterministische Parser extrahiert Möblierung, Kosten, Zimmer, Warnungen,
   speichert Belegstellen.
6. **Ranking** wird pro Kandidat berechnet: erst harte Kompatibilität, dann
   Punktzahl 0–100 mit Aufschlüsselung (Möblierung 35 %, Zimmer 25 %,
   Budget 20 %, Anfahrt 15 %, Datenqualität 5 %).
7. **Öffnen & Kontaktieren**: Anschreiben in Zwischenablage, Anzeige öffnet
   sich in neuem Tab, Anzeige geht in `IN_PROGRESS`. Erst nach expliziter
   Bestätigung wird sie `CONTACTED` — nie automatisch.
8. **Für Firmen-System kopieren**: drei-Feld-Panel mit Copy-Buttons und einem
   „Als eingetragen markieren"-Schalter (samt Zeitstempel und Kolleg:in).
9. **Andere Kolleg:innen** sehen den gemeinsamen Status, Doppelt-Kontakt für
   denselben Kandidaten ist auf DB-Ebene ausgeschlossen.

## Akzeptanzkriterien (Ausgangs-Szenario)

- 1 Kandidatin, Arbeitsort **Bad Rappenau-Fürfeld**, max. Warmmiete 900 €,
  möbliert bevorzugt, max. 35 min Anfahrt.
- Ein Suchlauf mit **≥ 5 Quellen** und **mindestens einer manuell/browser-only**
  Quelle.
- Ein manueller Task wird als „Nichts gefunden" markiert (mit Nutzer + Zeit).
- Acht Anzeigen werden importiert — vollmöbliert, unmöbliert, nur EBK, WBS
  erforderlich, Tauschwohnung, nur Kaltmiete, Möbelübernahme, mutmaßliches
  Duplikat.
- Ranking erklärt jede Position, WBS und Tausch werden hart als
  `INCOMPATIBLE` markiert.
- Öffnen & Kontaktieren kopiert das Anschreiben, öffnet die Original-URL, die
  Anzeige geht in `IN_PROGRESS`. Explizite Bestätigung setzt `CONTACTED` und
  legt eine unveränderliche `ContactAttempt` mit Message-Snapshot an.
- Zweiter Kontaktversuch derselben Kandidatin/Anzeige wird geblockt.
- Drei-Feld-Panel für „Wohnung/Objekt", „Link", „Ort" ist auf einen Klick
  kopierbar; als eingetragen markieren protokolliert Zeit und Nutzer:in.
- Alles funktioniert ohne KI-Key, ohne Live-Portal-API.

## Nicht-Ziele (V1)

- Nachrichten-Massenversand, automatisches Absenden, CAPTCHA-Umgehung.
- Portal-Passwörter im System speichern.
- Firmen-System per API anbinden.
- Kandidat:innen- oder Vermieter:innen-Accounts.
- Vollständiges ATS/CRM.
- Nachrichtengenerierung durch die App.
- Vektor-Suchen, Embeddings, agentische Web-Scraper.
- Native iOS/Android-Apps.
- Multilingual — deutsche UI reicht.
