/**
 * Die Bausteine der App, einzeln an- und ausschaltbar.
 *
 * Diese Werkbank kann inzwischen eine Menge: WG-Vorschläge, Telegram,
 * Überbrückungskosten, Zeitleiste, Textprüfung, Antwort-Statistik. Nicht jedes
 * Team braucht jedes davon, und ein Bildschirm voller Dinge, die nie jemand
 * benutzt, ist teurer als ein Bildschirm ohne sie — er kostet bei jedem
 * Hinsehen Aufmerksamkeit.
 *
 * Also: alles Nicht-Zwingende ist ein Baustein mit einem Schalter. An heißt,
 * die Funktion existiert; aus heißt, sie ist nirgends zu sehen und rechnet
 * auch nichts. Kein halber Zustand.
 *
 * ## Die zwei Regeln
 *
 * 1. **Ausschalten darf nie etwas kaputt machen.** Wer WG-Vorschläge
 *    abschaltet, verliert den Menüpunkt und die Berechnung — nicht die
 *    Kandidaten, die schon als WG-fähig markiert sind. Ein Baustein blendet
 *    aus, er löscht nicht.
 * 2. **Was die App zu einer Wohnungssuche macht, ist kein Baustein.** Suche,
 *    Anzeigenliste, Bewertung, Kontaktverlauf haben hier bewusst keinen
 *    Schalter. Alles abschalten zu können klingt nach Freiheit und heißt in
 *    der Praxis, dass niemand mehr weiß, was das Programm eigentlich tut.
 *
 * Neue Funktionen kommen als Baustein herein: hier einen Eintrag ergänzen,
 * `defaultOn` bewusst wählen, und dort abfragen, wo die Funktion sichtbar
 * wird. Mehr braucht es nicht.
 */

/** Wozu ein Baustein gehört — nur zur Gruppierung auf dem Bildschirm. */
export type FeatureGroup = 'suche' | 'kontakt' | 'planung' | 'benachrichtigung' | 'auswertung';

export interface FeatureDefinition {
  key: string;
  /** Überschrift des Schalters. */
  label: string;
  /** Ein Satz: was ist an, wenn das an ist. */
  description: string;
  group: FeatureGroup;
  /**
   * Zustand ohne jede Einstellung.
   *
   * Neue Bausteine starten aus, außer sie ersetzen etwas, das vorher immer da
   * war — sonst ändert ein Deploy für alle stillschweigend die Oberfläche.
   */
  defaultOn: boolean;
  /** Was beim Ausschalten verschwindet, für den Hinweis unter dem Schalter. */
  offMeans: string;
}

export const FEATURE_GROUP_LABELS: Record<FeatureGroup, string> = {
  suche: 'Suche & Anzeigen',
  kontakt: 'Kontakt & Anfragen',
  planung: 'Planung & Priorität',
  benachrichtigung: 'Benachrichtigungen',
  auswertung: 'Auswertung',
};

export const FEATURES = [
  /* ------------------------------------------------ Suche & Anzeigen --- */
  {
    key: 'livenessCheck',
    label: 'Textprüfung: Ist die Anzeige noch online?',
    description:
      'Liest Anzeigenseiten im Text nach und blendet aus, was erkennbar vergeben ist. Portale liefern gelöschte Anzeigen als ganz normale Seite aus — ohne diese Prüfung merkt es erst, wer sie öffnet.',
    group: 'suche',
    defaultOn: true,
    offMeans: 'Anzeigen bleiben stehen, bis jemand sie von Hand als vergeben markiert.',
  },
  {
    key: 'duplicateDetection',
    label: 'Doppelte Anzeigen zusammenfassen',
    description:
      'Erkennt dieselbe Wohnung auf zwei Portalen und markiert sie als Dublette, damit niemand denselben Vermieter zweimal anschreibt.',
    group: 'suche',
    defaultOn: true,
    offMeans: 'Jede Anzeige steht für sich — dieselbe Wohnung kann mehrfach in der Liste erscheinen.',
  },
  {
    key: 'whatIf',
    label: 'Suchkriterien durchspielen',
    description:
      'Rechnet auf der Ergebnisseite aus, wie viele Treffer 50 € mehr Budget oder 10 Minuten mehr Anfahrt bringen würden.',
    group: 'suche',
    defaultOn: true,
    offMeans: 'Das Panel verschwindet. Kriterien ändert man dann direkt im Suchprofil.',
  },
  {
    key: 'ageFilter',
    label: 'Nur frisch inserierte Anzeigen',
    description:
      'Blendet Anzeigen aus, die älter sind als eine eingestellte Zahl von Tagen. Standardmäßig ohne Wirkung, bis eine Obergrenze gesetzt ist.',
    group: 'suche',
    defaultOn: true,
    offMeans: 'Das Alter wird weiterhin angezeigt, filtert aber nichts.',
  },

  /* ---------------------------------------------- Kontakt & Anfragen --- */
  {
    key: 'contactExtraction',
    label: 'Telefonnummer aus der Anzeige lesen',
    description:
      'Liest Telefonnummer, E-Mail und Ansprechpartner aus dem Anzeigentext und hebt Zeilen mit Nummer grün hervor. Ein Anruf wird in zehn Minuten beantwortet, ein Formular am Donnerstag.',
    group: 'kontakt',
    defaultOn: true,
    offMeans: 'Kontaktdaten werden nicht mehr gelesen. Bereits gefundene Nummern bleiben gespeichert.',
  },
  {
    key: 'outboundEmail',
    label: 'Anfragen aus der App versenden',
    description:
      'Wo eine Anzeige selbst eine Adresse nennt, geht die Anfrage direkt aus dem gemeinsamen Postfach raus — samt Wiedervorlage und Antwort-Zuordnung.',
    group: 'kontakt',
    defaultOn: true,
    offMeans: 'Anfragen laufen wieder über „kopieren, Portal öffnen, bestätigen“.',
  },
  {
    key: 'followUps',
    label: 'Wiedervorlagen',
    description:
      'Legt nach einer Anfrage automatisch „Antwort prüfen“ an und schließt die Aufgabe, sobald jemand antwortet.',
    group: 'kontakt',
    defaultOn: true,
    offMeans: 'Keine automatischen Aufgaben mehr. Wer nachfasst, merkt es sich selbst.',
  },

  /* --------------------------------------------- Planung & Priorität --- */
  {
    key: 'wgMatching',
    label: 'WG-Vorschläge',
    description:
      'Schlägt Kandidatinnen vor, die sich eine Wohnung teilen könnten — nur solche, die dem ausdrücklich zugestimmt haben.',
    group: 'planung',
    defaultOn: true,
    offMeans: 'Der Menüpunkt „WG-Vorschläge“ verschwindet. Die Zustimmung am Kandidaten bleibt gespeichert.',
  },
  {
    key: 'bridging',
    label: 'Überbrückung berechnen',
    description:
      'Rechnet aus, was die Lücke zwischen Ankunft und „frei ab“ an Zwischenunterkunft kosten würde, statt eine gute Wohnung still auszusortieren.',
    group: 'planung',
    defaultOn: true,
    offMeans: 'Wohnungen mit späterem Einzugsdatum werden ohne Kostenhinweis angezeigt.',
  },
  {
    key: 'timeline',
    label: 'Zeitleiste',
    description: 'Zeigt den Fall als Linie: Vertrag, Ankunft, Wochen bis zum Einzug, Gefahrenzone.',
    group: 'planung',
    defaultOn: true,
    offMeans: 'Die Zeitleiste auf der Fallübersicht verschwindet; die Daten bleiben.',
  },
  {
    key: 'appointments',
    label: 'Termine',
    description: 'Besichtigungen, Videocalls und Übergaben am Fall festhalten.',
    group: 'planung',
    defaultOn: true,
    offMeans: 'Der Reiter „Termine“ verschwindet. Bestehende Termine bleiben gespeichert.',
  },

  /* ------------------------------------------------ Benachrichtigung --- */
  {
    key: 'telegram',
    label: 'Telegram',
    description:
      'Schickt eine Nachricht, wenn jemand geantwortet hat oder eine Wiedervorlage fällig ist — und nimmt Notizen aus dem Chat entgegen.',
    group: 'benachrichtigung',
    defaultOn: false,
    offMeans: 'Keine Push-Nachrichten. Alles steht weiterhin unter „Aufgaben & Posteingang“.',
  },
  {
    key: 'weeklyDigest',
    label: 'Wochenübersicht',
    description: 'Fasst einmal pro Woche zusammen, was gelaufen ist und was liegen geblieben ist.',
    group: 'benachrichtigung',
    defaultOn: false,
    offMeans: 'Keine Zusammenfassung. Der Verlauf bleibt jederzeit abrufbar.',
  },

  /* ---------------------------------------------------- Auswertung ----- */
  {
    key: 'responseStats',
    label: 'Antwortquote',
    description:
      'Zählt, wie viele Anfragen beantwortet werden — je Portal und insgesamt. Beantwortet die Frage, ob das Anschreiben funktioniert oder ob es an der Quelle liegt.',
    group: 'auswertung',
    defaultOn: true,
    offMeans: 'Die Auswertung verschwindet. Gezählt wird weiterhin, nur nicht gezeigt.',
  },
  {
    key: 'stalledCases',
    label: 'Warnung bei Fällen ohne Treffer',
    description:
      'Meldet Fälle, für die seit Tagen keine passende Wohnung dabei war — das ist fast immer ein zu enges Suchprofil und kein leerer Markt.',
    group: 'auswertung',
    defaultOn: true,
    offMeans: 'Kein Hinweis mehr. Auffallen muss es dann jemandem beim Durchsehen.',
  },
] as const satisfies readonly FeatureDefinition[];

/** Die Schlüssel, direkt aus der Liste oben — kein zweiter Ort zum Pflegen. */
export type FeatureKey = (typeof FEATURES)[number]['key'];

/** Welche Bausteine an sind. Fehlende Einträge bekommen ihren Standard. */
export type FeatureSettings = Partial<Record<FeatureKey, boolean>>;

export const DEFAULT_FEATURES: FeatureSettings = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.defaultOn]),
) as FeatureSettings;

/**
 * Ist dieser Baustein an?
 *
 * Nimmt alles entgegen, was aus der Datenbank kommen kann — auch `null` oder
 * eine kaputte Zeile. Eine unlesbare Einstellung darf nie dazu führen, dass
 * die halbe Oberfläche verschwindet, also gewinnt im Zweifel der Standard.
 */
export function isFeatureOn(settings: FeatureSettings | null | undefined, key: FeatureKey): boolean {
  const value = settings?.[key];
  if (typeof value === 'boolean') return value;
  return FEATURES.find((f) => f.key === key)?.defaultOn ?? false;
}

/** Die Bausteine einer Gruppe, in der Reihenfolge der Liste oben. */
export function featuresByGroup(group: FeatureGroup) {
  return FEATURES.filter((f) => f.group === group);
}

/** Alle Gruppen, die überhaupt Bausteine haben. */
export function featureGroups(): FeatureGroup[] {
  return [...new Set(FEATURES.map((f) => f.group))];
}
