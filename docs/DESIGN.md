# Oberfläche: Tokens, Tag- und Nachtansicht

Wer eine Farbe ändern will, ändert sie an genau einer Stelle. Diese Datei
erklärt, wo diese Stelle ist und warum die Nachtansicht so wenige Regeln
braucht.

## Ein Ort für Farben

Alle Farben, Radien und Schatten stehen als CSS-Variablen in
`src/app/globals.css`, ganz oben im `:root`-Block. Komponenten schreiben nie
`#0e7c86`, sondern `var(--brand)`. Das ist keine Kosmetik: es ist der Grund,
warum die Nachtansicht überhaupt möglich war, ohne jede Komponente anzufassen.

Die wichtigsten Gruppen:

| Gruppe | Tokens | Wofür |
| --- | --- | --- |
| Marke | `--brand`, `--brand-hover`, `--brand-soft`, `--brand-border`, `--brand-text-on` | Der Akzent. Alles, was angeklickt wird. |
| Flächen | `--bg`, `--surface`, `--surface-2`, `--surface-3` | Untergrund und drei Stufen darüber. |
| Linien | `--border`, `--border-strong`, `--hairline` | Trennung ohne Kästen. |
| Text | `--text`, `--text-muted`, `--text-subtle` | Drei Stufen, mehr braucht es nicht. |
| Bedeutung | `--success`, `--warning`, `--danger`, `--info` je mit `-soft` und `-border` | Zustände. |
| Glas | `--glass`, `--glass-solid`, `--glass-quiet` | Die milchigen Karten der Ergebnisliste. |
| Neon | `--neon`, `--neon-soft` | Der Lichtrand. Tagsüber bewusst leer. |

## Wie die Nachtansicht funktioniert

Drei Teile, mehr nicht:

1. **`:root[data-theme='dark']`** am Ende von `globals.css` setzt dieselben
   Tokens noch einmal, mit Nachtwerten. Das erledigt den größten Teil der
   Oberfläche, weil die Komponenten ohnehin nur Variablen lesen.
2. **Ein kurzes Skript im `<head>`** (`src/app/layout.tsx`) schreibt das
   gespeicherte Thema auf `<html data-theme="…">`, bevor das erste Pixel
   gezeichnet wird. Ohne das blitzt bei jedem Laden die helle Ansicht auf.
   Ist nichts gespeichert, entscheidet das Betriebssystem
   (`prefers-color-scheme`).
3. **Der Schalter** (`src/app/_components/ThemeToggle.tsx`) in der Kopfleiste
   schreibt `data-theme` und `localStorage`. Mehr tut er nicht.

Danach bleiben nur die Stellen, an denen früher eine Farbe fest im Regelwerk
stand und die deshalb einzeln nachgezogen werden mussten — der aktive Reiter,
die beiden Urteils-Abzeichen, der Mangel-Chip, die Gefahrenzone der Zeitleiste.
Sie stehen alle beisammen unter dem Dark-Block und sind mit
`[data-theme='dark']` gekennzeichnet.

### Warum die Nachtfarben nicht einfach umgedreht sind

* Der Untergrund ist ein sehr dunkles Blaugrün, kein Schwarz: reines Schwarz
  lässt Schatten verschwinden, und dann steht jede Karte auf derselben Ebene.
* Der Text hört kurz vor Weiß auf. Weiß auf Schwarz blendet nach einer Stunde.
* Schatten werden nachts kräftiger und schwarz, weil ein zarter Schatten auf
  dunklem Grund unsichtbar ist.
* Das „Glas" wird zur beleuchteten Scheibe. Weiße Transparenz über dunklem
  Grund ergibt Nebel, kein Glas.
* Das Neon ist der Markenton als Licht statt als Farbe: ein `box-shadow`,
  also ohne Einfluss auf das Layout und über ein Token abschaltbar.

## Eine neue Komponente einfärben

1. Nur Tokens verwenden, keine festen Farbwerte.
2. Nachtansicht einschalten und hinsehen. Wenn es passt, ist nichts weiter zu
   tun — das ist der Normalfall.
3. Passt es nicht, liegt es fast immer an einer festen Farbe. Erst die
   ersetzen; eine `[data-theme='dark']`-Regel ist der letzte Ausweg, nicht der
   erste Griff.
