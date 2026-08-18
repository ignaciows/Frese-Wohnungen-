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
4. Als **autorisierten Redirect-URI** exakt das hier eintragen:

   ```
   https://DEINE-DOMAIN/google/callback
   ```

   Exakt heißt exakt — Google vergleicht Zeichen für Zeichen, inklusive
   `https` und ohne abschließenden Schrägstrich.
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
