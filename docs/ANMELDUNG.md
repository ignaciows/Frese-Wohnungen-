# Anmeldung

Zwei Wege in die App, nebeneinander: **E-Mail + Passwort** (läuft immer) und
**Anmelden mit Google** (optional, muss einmal eingerichtet werden).

## Mit Google anmelden — Einrichtung

Einmalig, ungefähr zehn Minuten.

1. **Google Cloud Console** öffnen (`console.cloud.google.com`) und ein Projekt
   anlegen — oder ein bestehendes der Firma nehmen.
2. **APIs & Dienste → OAuth-Zustimmungsbildschirm**. Bei einem
   Google-Workspace-Konto **„Intern"** wählen. Das ist der wichtige Punkt:
   intern heißt, Google prüft nichts und niemand außerhalb der Firma kann sich
   überhaupt anmelden. Ohne Workspace bleibt nur „Extern", und dann muss jede
   Person einzeln als Testnutzer eingetragen werden.
3. **Anmeldedaten → OAuth-Client-ID erstellen → Webanwendung.**
4. Als **autorisierte Redirect-URIs** exakt das hier eintragen:

   ```
   https://DEINE-DOMAIN/google/callback            ← Anmelden
   https://DEINE-DOMAIN/google/postfach/callback   ← Postfach verbinden
   ```

   Exakt heißt exakt — Google vergleicht Zeichen für Zeichen, inklusive
   `https` und ohne abschließenden Schrägstrich. Die zweite Zeile braucht nur,
   wer auch ein Postfach über Google anbinden will (siehe unten).
5. Client-ID und Client-Secret in die Umgebung der App eintragen:

   ```
   GOOGLE_CLIENT_ID="…"
   GOOGLE_CLIENT_SECRET="…"
   GOOGLE_ALLOWED_DOMAIN="frese-recruiting.de"
   APP_URL="https://DEINE-DOMAIN"
   ```

Fertig. Auf der Anmeldeseite erscheint jetzt „Mit Google anmelden". Sind die
Werte nicht gesetzt, erscheint der Knopf nicht und die Routen antworten mit
404 — es gibt dann keinen halben Zustand.

`APP_URL` ist nicht optional, sobald Google-Login läuft: die `redirect_uri`
muss der eingetragenen exakt entsprechen, und der `Host`-Header einer Anfrage
lässt sich fälschen.

## Wer hereinkommt

Die Prüfungen laufen der Reihe nach, jede kann alleine ablehnen:

```
state stimmt → Code eingelöst → E-Mail von Google bestätigt
                                      │
             ┌────────────────────────┴────────────────────────┐
   Konto existiert schon                          Konto ist neu
   → wird mit der Google-ID verknüpft             → nur bei passender Domain
   → darf herein, egal welche Domain              → immer als COLLEAGUE
```

Drei Regeln, die absichtlich fest im Code stehen:

- **Nur die eigene Domain bekommt automatisch ein Konto.** Ohne
  `GOOGLE_ALLOWED_DOMAIN` wird niemand neu angelegt; anmelden kann sich dann
  nur, wer schon als Nutzer existiert. Ein Google-Login, das jedes Google-Konto
  der Welt akzeptiert, ist kein Login.
- **Niemand wird von selbst Admin.** Neue Konten sind immer COLLEAGUE. Rollen
  vergibt ein Mensch.
- **Die E-Mail muss von Google bestätigt sein.** Sonst ist die Adresse eine
  Behauptung und keine Identität.

Ein bestehendes Konto darf unabhängig von der Domain herein: wer schon angelegt
ist, wurde von einem Menschen angelegt.

## Was die App dabei *nicht* bekommt

Der angeforderte Zugriff ist `openid email profile` — Name und E-Mail, sonst
nichts. **Kein Zugriff auf das Postfach**, keinen Kalender, keine Kontakte.

Das ist ein häufiges Missverständnis, deshalb ausdrücklich: „Anmelden mit
Google" und „Mails aus einem Google-Postfach lesen" sind zwei verschiedene
Dinge mit zwei verschiedenen Berechtigungen. Das Suchagent-Postfach für
ImmoScout24 und Immowelt läuft weiterhin über **IMAP mit App-Passwort**, unter
Einstellungen → Konten & Postfach (siehe `docs/EMAIL_INGEST.md`). Das
funktioniert mit Gmail genauso wie mit jedem anderen Anbieter und braucht
keine Google-Freigabe.

## Konten verknüpfen und trennen

- **Bestehendes Konto + Google:** Beim ersten Anmelden über Google wird die
  Google-ID am Konto mit derselben E-Mail-Adresse hinterlegt. Danach gehen
  beide Wege — Passwort und Google.
- **Nur-Google-Konto:** Hat kein Passwort. Der Versuch, sich mit Passwort
  anzumelden, sagt das auch so, statt „falsche Zugangsdaten" zu behaupten.
- **Adresse geändert:** Die Zuordnung hängt an Googles unveränderlicher
  Konto-ID (`sub`), nicht an der E-Mail. Wer umbenannt wird, behält Konto und
  Verlauf.
- **Zugriff entziehen:** Nutzer auf `active = false` setzen. Das sperrt beide
  Wege sofort.

## Wenn du daran arbeitest

| Datei | Was darin steckt |
| --- | --- |
| `src/lib/googleAuth.ts` | Konfiguration, URL-Bau, Code-Einlösung, Domain-Prüfung |
| `src/app/(auth)/google/start/route.ts` | Schritt 1: `state` setzen, zu Google schicken |
| `src/app/(auth)/google/callback/route.ts` | Schritt 2: prüfen, Konto finden/anlegen, Sitzung setzen |
| `src/lib/session.ts` | Die Sitzung selbst — unverändert, beide Wege enden hier |
| `tests/googleAuth.test.ts` | Die Regeln oben, als Tests |

Bewusst ohne Auth-Bibliothek: die Sitzung existiert bereits (iron-session), und
OAuth mit Authorization Code sind drei HTTP-Aufrufe. Eine Bibliothek hätte ihr
eigenes Sitzungsmodell mitgebracht — zwei Wahrheiten darüber, wer angemeldet
ist, sind der Anfang jedes Auth-Fehlers.

## Ein Postfach mit Google verbinden

Das ist **nicht** dasselbe wie die Anmeldung. Dort geht es darum, wer vor dem
Bildschirm sitzt; hier darum, dass die App ein Postfach lesen und daraus
verschicken darf. Zwei Fragen, zwei Zustimmungen — dieselben zwei
Umgebungsvariablen, weil es dasselbe Google-Projekt ist.

Einmalig zusätzlich in der Cloud Console:

1. **APIs & Dienste → Bibliothek → Gmail API** aktivieren.
2. Im **OAuth-Zustimmungsbildschirm** den Bereich `https://mail.google.com/`
   hinzufügen. Das ist der Bereich für IMAP und SMTP — die feineren
   Gmail-Bereiche gelten nur für die Gmail-API, und die App spricht bewusst
   IMAP, damit derselbe Weg auch mit Strato oder Outlook funktioniert.
3. Den zweiten Redirect-URI von oben eintragen.

Danach steht in **Einstellungen → Konten & Postfach** der Knopf „Postfach mit
Google verbinden". Ein Klick, Konto wählen, zustimmen — fertig. Kein
App-Passwort, keine Servernamen.

### ⚠️ Intern oder Extern — das entscheidet, ob es dauerhaft läuft

Der Bereich `https://mail.google.com/` gilt bei Google als **restricted**, und
davon hängt mehr ab als eine Häkchenliste:

| Zustimmungsbildschirm | Prüfung durch Google | Wie lange der Zugriff hält |
| --- | --- | --- |
| **Intern** (nur mit Google Workspace) | keine | **dauerhaft** |
| **Extern**, Status „Test" | keine, aber Warnbildschirm und max. 100 Testnutzer | **7 Tage**, dann muss neu verbunden werden |
| **Extern**, veröffentlicht | jährliches Sicherheits-Audit durch einen von Google zugelassenen Prüfer | dauerhaft |

Der mittlere Fall ist die Falle: es funktioniert, sieht grün aus, und eine
Woche später steht das Postfach auf „muss neu verbunden werden" — und zwar
jede Woche wieder. Google vergibt für externe Apps im Teststatus bewusst nur
kurzlebige Refresh-Token, sobald mehr als Name und E-Mail-Adresse im Spiel
sind.

**Praktisch heißt das:**

- **Firmenkonto mit eigener Domain (Workspace)** → „Intern" wählen, fertig.
  Das ist der einzige Weg, der ohne Audit dauerhaft läuft.
- **Privates @gmail.com** → „Intern" gibt es dort nicht. Statt sich mit dem
  Sieben-Tage-Rhythmus herumzuschlagen, lieber den IMAP-Weg nehmen:
  **App-Passwort** unter *myaccount.google.com → Sicherheit → Bestätigung in
  zwei Schritten → App-Passwörter*, dann in der App unter „Anderes Postfach
  (IMAP/SMTP)" eintragen. Kein Cloud-Projekt, keine Prüfung, kein Ablauf.
  Server: `imap.gmail.com` 993 und `smtp.gmail.com` 465.

Das gilt nur für das **Postfach**. Für die reine Anmeldung („Mit Google
anmelden") reichen Name und E-Mail-Adresse, und dort gibt es weder Prüfung noch
Sieben-Tage-Grenze.

### Was gespeichert wird

Nur der **Refresh-Token**, verschlüsselt wie jedes andere Geheimnis
(`CREDENTIAL_KEY`). Zugriffstoken halten eine Stunde und werden geholt, wenn
sie gebraucht werden — ein abgelaufenes aufzubewahren hätte keinen Wert.

### Wenn ein Postfach rot wird

„Muss neu verbunden werden" heißt: Google hat den Zugriff zurückgezogen.
Passiert, wenn jemand im Google-Konto unter „Drittanbieter-Zugriff" aufräumt,
das Passwort ändert oder ein Admin die App entfernt. Der Knopf auf der Karte
führt denselben Weg noch einmal; danach ist es grün.

Wichtig ist der Unterschied zu „Google war gerade nicht erreichbar" — das
wartet sich aus und markiert nichts rot. Ein gemeinsamer Fehlerzustand für
beides führt dazu, dass das eine ignoriert und das andere übersehen wird.

### Mehrere Postfächer

Ist der Normalfall: das Postfach für die Suchaufträge, das geteilte Postfach
des Teams, ein Testkonto. Jedes wird einzeln verbunden, einzeln geprüft und
einzeln ausgelesen — ein abgelaufener Zugang legt die anderen nicht still. Auf
dem Bildschirm stehen die, die jemand anfassen muss, vorn.
