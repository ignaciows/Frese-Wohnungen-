/**
 * German UI labels and badge tones for enum values. Kept in one place so the
 * same status always looks and reads the same everywhere in the app.
 */

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export const MATCH_STATUS: Record<string, { label: string; tone: Tone; icon: string }> = {
  NEW: { label: 'Neu', tone: 'neutral', icon: '○' },
  FAVORITE: { label: 'Favorit', tone: 'warning', icon: '★' },
  IN_PROGRESS: { label: 'In Arbeit', tone: 'info', icon: '◐' },
  CONTACTED: { label: 'Kontaktiert', tone: 'success', icon: '✓' },
  REJECTED: { label: 'Abgelehnt', tone: 'neutral', icon: '×' },
  EXPIRED: { label: 'Abgelaufen', tone: 'neutral', icon: '–' },
};

export const COMPATIBILITY: Record<string, { label: string; tone: Tone; short: string }> = {
  COMPATIBLE: { label: 'Passend', tone: 'success', short: 'Passend' },
  NEAR_MATCH: { label: 'Fast passend — prüfen', tone: 'warning', short: 'Fast passend' },
  INCOMPATIBLE: { label: 'Nicht passend', tone: 'danger', short: 'Nicht passend' },
  INSUFFICIENT_DATA: { label: 'Daten unvollständig', tone: 'neutral', short: 'Unvollständig' },
};

export const FURNISHING: Record<string, string> = {
  FULLY_FURNISHED: 'Vollmöbliert',
  FURNISHED: 'Möbliert',
  PARTIALLY_FURNISHED: 'Teilmöbliert',
  FURNITURE_TAKEOVER: 'Möbelübernahme',
  UNFURNISHED: 'Unmöbliert',
  UNKNOWN: 'Möblierung unbekannt',
};

export const SOURCE_CHECK_STATUS: Record<string, { label: string; tone: Tone; icon: string }> = {
  PENDING: { label: 'Offen', tone: 'neutral', icon: '○' },
  IN_PROGRESS: { label: 'In Arbeit', tone: 'info', icon: '◐' },
  CHECKED_NO_RESULTS: { label: 'Geprüft — nichts gefunden', tone: 'neutral', icon: '✓' },
  CHECKED_RESULTS_IMPORTED: { label: 'Geprüft — importiert', tone: 'success', icon: '✓' },
  UNAVAILABLE: { label: 'Nicht erreichbar', tone: 'danger', icon: '!' },
  SKIPPED: { label: 'Übersprungen', tone: 'neutral', icon: '–' },
};

/**
 * Wie eine Quelle zu uns kommt — siehe `Source.route` im Schema. Zwei Wege,
 * weil es genau zwei gibt.
 */
export const SOURCE_ROUTE: Record<string, { label: string; hint: string; tone: Tone }> = {
  DISCOVERY: {
    label: 'Automatischer Suchlauf',
    hint: 'Die App liest die Ergebnisliste des Portals selbst.',
    tone: 'success',
  },
  EMAIL_ALERT: {
    label: 'Suchauftrag per E-Mail',
    hint: 'Das Portal schickt neue Treffer an das gemeinsame Postfach.',
    tone: 'info',
  },
};

export const MAPPING_QUALITY: Record<string, { label: string; tone: Tone; hint: string }> = {
  EXACT: { label: 'Genau', tone: 'success', hint: 'Portal-Filter deckt sich exakt' },
  APPROXIMATE: { label: 'Ungefähr', tone: 'info', hint: 'Breiter suchen — wir filtern danach exakt' },
  MANUAL: { label: 'Manuell', tone: 'warning', hint: 'Im Portal von Hand eintragen' },
  UNSUPPORTED: { label: 'Nicht möglich', tone: 'danger', hint: 'Portal kann das nicht — nach Import prüfen' },
  UNKNOWN: { label: 'Ungeprüft', tone: 'neutral', hint: 'Zuordnung noch nicht verifiziert' },
};

export const RESPONSE_OUTCOME: Record<string, { label: string; tone: Tone; icon: string }> = {
  AWAITING: { label: 'Wartet auf Antwort', tone: 'neutral', icon: '⋯' },
  POSITIVE: { label: 'Positiv', tone: 'success', icon: '✓' },
  NEGATIVE: { label: 'Absage', tone: 'danger', icon: '×' },
  NEEDS_INFO: { label: 'Unterlagen angefragt', tone: 'warning', icon: '!' },
};

export const PRIORITY_TIER: Record<string, { label: string; tone: Tone; icon: string }> = {
  CRITICAL: { label: 'Kritisch', tone: 'danger', icon: '▲' },
  HIGH: { label: 'Hoch', tone: 'warning', icon: '▲' },
  NORMAL: { label: 'Normal', tone: 'info', icon: '■' },
  LOW: { label: 'Niedrig', tone: 'neutral', icon: '▼' },
};

export function difficultyLabel(d: number): string {
  if (d >= 80) return 'sehr schwer';
  if (d >= 60) return 'schwer';
  if (d >= 40) return 'mittel';
  if (d >= 20) return 'einfach';
  return 'sehr einfach';
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeDays(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return formatDate(date);
}
