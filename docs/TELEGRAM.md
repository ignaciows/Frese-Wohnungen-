# Telegram-Anbindung

Zwei Richtungen:

- **Raus:** Das Team bekommt eine Nachricht, wenn etwas einen Menschen braucht —
  ein Vermieter hat geantwortet, eine Wiedervorlage ist fällig, ein Termin steht
  an. Damit niemand die App den ganzen Tag offen halten muss.
- **Rein:** Aus dem Chat lassen sich Status abfragen und Notizen an ein Gespräch
  hängen. Ein Anruf im Auto landet damit trotzdem in der Historie.

## Einrichtung

### 1. Bot anlegen

In Telegram **@BotFather** anschreiben → `/newbot` → Namen vergeben. BotFather
gibt ein Token wie `123456789:AA...` zurück.

### 2. Chat-ID herausfinden

Den Bot in die Team-Gruppe einladen, dort irgendetwas schreiben, dann:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

In der Antwort steht `"chat":{"id":-1001234567890,...}`. Gruppen-IDs sind negativ.

### 3. Variablen setzen

```
TELEGRAM_BOT_TOKEN="123456789:AA..."
TELEGRAM_CHAT_ID="-1001234567890"
TELEGRAM_WEBHOOK_SECRET="<langes Zufallstoken>"
```

### 4. Webhook registrieren

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{
        "url": "https://<deine-domain>/api/telegram/webhook",
        "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
      }'
```

Telegram schickt das Geheimnis bei jedem Aufruf im Header
`X-Telegram-Bot-Api-Secret-Token` mit; die App verwirft alles andere.

### 5. Tagesübersicht planen

```bash
curl -X POST -H "x-ingest-token: $INGEST_TOKEN" https://<deine-domain>/api/digest
```

Einmal morgens genügt.

## Befehle im Chat

| Befehl | Wirkung |
| --- | --- |
| `/status` | aktive Kandidaten, Anfragen ohne Antwort, fällige Wiedervorlagen |
| `/notiz REF Text` | hängt eine Notiz an das jüngste Gespräch des Kandidaten |
| `/hilfe` | kurze Übersicht |

Beispiel: `/notiz CAND-2026-014 Vermieter ruft morgen zurück`

Über Telegram erfasste Notizen werden im Verlauf mit **[via Telegram]**
gekennzeichnet, damit niemand sie für eine Portal-Nachricht des Vermieters hält.

## Grenzen und Sicherheit

- **Nur der konfigurierte Chat** darf den Bot bedienen. Nachrichten aus anderen
  Chats werden ignoriert, auch wenn jemand den Bot dort einlädt.
- **Keine Kandidatendaten im Klartext, wo es vermeidbar ist**: Benachrichtigungen
  nennen die interne Referenz (`CAND-2026-014`) und den Wohnungstitel, nicht das
  Anschreiben oder persönliche Daten. Trotzdem gilt: eine Telegram-Gruppe ist
  ein externer Dienst — nur Personen aufnehmen, die auch Zugriff auf die App
  haben dürfen.
- **Ausfälle sind harmlos.** Jeder Sendeversuch ist best-effort mit Timeout;
  ist Telegram nicht erreichbar, läuft der Kontaktfluss in der App unverändert
  weiter.
- Der Webhook antwortet immer mit 200, sonst wiederholt Telegram dieselbe
  Nachricht endlos.

---

# Antworten von Vermietern im Verlauf

Kommt eine Antwort per Mail ins Suchagent-Postfach, hängt die App sie an das
richtige Gespräch statt eine neue Anzeige anzulegen.

## Wie eine Antwort erkannt wird

| Signal | Bedeutung |
| --- | --- |
| Mail verweist auf **genau eine** Anzeige, die wir angeschrieben haben | Antwort |
| Mehrere Anzeigen in einer Mail | Suchagent-Digest |
| Formulierungen wie „Ihre Anfrage", „AW:", „neue Nachricht" | Antwort |
| Formulierungen wie „Suchagent", „neue Angebote", „Ihr Suchprofil" | Digest — schlägt einen einzelnen Treffer |

Zitierte Vorgeschichte und Signaturen werden entfernt, damit im Verlauf steht,
was der Vermieter geschrieben hat — nicht das eigene Anschreiben zurückzitiert.

## Was bewusst **nicht** automatisch passiert

Die **Bewertung** der Antwort bleibt beim Menschen. Eine eingehende Nachricht
setzt den Status **nicht** auf „positiv" oder „Absage" — das entscheidet, wer
sie liest. Automatisch erfasst wird nur, *dass* geantwortet wurde.

## Mehrdeutige Fälle

Wurde dieselbe Wohnung für mehrere Kandidaten angeschrieben, entscheidet die
Plus-Adresse (`postfach+CAND-2026-014@…`). Bleibt es mehrdeutig, landet die Mail
mit Status `UNMATCHED_REPLY` im Protokoll unter Einstellungen — sichtbar, aber
ohne falsche Zuordnung.
