/**
 * Given the canonical filters + a source's per-filter mapping, build:
 *  - the human-readable recipe the colleague sees on the source task,
 *  - the derived search URL when (and only when) the template is validated.
 *
 * The recipe is intentionally verbose about UNSUPPORTED and MANUAL filters, so
 * the colleague can enter or verify them on the portal. Nothing is silently
 * dropped.
 */

import { CANONICAL_FILTER_LABELS, type CanonicalFilterKey } from './canonicalFilters';
import { formatEuroCents } from '@/lib/money';

export type MappingQuality = 'EXACT' | 'APPROXIMATE' | 'MANUAL' | 'UNSUPPORTED' | 'UNKNOWN';

export interface CanonicalFilterValues {
  location: {
    city?: string | null;
    postalCode?: string | null;
    address?: string | null;
  };
  radiusKm: number | null;
  commuteMinutes: number | null;
  maxWarmmieteCents: number;
  minRooms: number;
  propertyType: 'APARTMENT' | 'TEMPORARY';
  furnished: 'REQUIRED' | 'PREFERRED' | 'EITHER';
  wbs: 'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';
  minLivingSpace: number | null;
  availableFrom: Date | null;
  pets: string | null;
}

export interface SourceMappingEntry {
  quality: MappingQuality;
  portalLabel?: string | null;
  note?: string | null;
}

export type SourceMapping = Partial<Record<CanonicalFilterKey, SourceMappingEntry>>;

export interface RecipeLine {
  filter: CanonicalFilterKey;
  label: string;
  quality: MappingQuality;
  portalLabel: string | null;
  humanValue: string;
  advice: string;
}

export interface Recipe {
  lines: RecipeLine[];
  headline: string;
}

function formatValue(filter: CanonicalFilterKey, values: CanonicalFilterValues): string {
  switch (filter) {
    case 'location': {
      const parts = [values.location.postalCode, values.location.city, values.location.address].filter(Boolean);
      return parts.length ? parts.join(', ') : '—';
    }
    case 'radiusKm':
      return values.radiusKm != null ? `${values.radiusKm} km` : '—';
    case 'commuteMinutes':
      return values.commuteMinutes != null ? `${values.commuteMinutes} min` : '—';
    case 'maxWarmmiete':
      return `≤ ${formatEuroCents(values.maxWarmmieteCents)}`;
    case 'minRooms':
      return `≥ ${values.minRooms} Zimmer`;
    case 'propertyType':
      return values.propertyType === 'APARTMENT' ? 'Nur Wohnungen' : 'Temporäres Wohnen';
    case 'furnished':
      return values.furnished === 'REQUIRED'
        ? 'muss möbliert sein'
        : values.furnished === 'PREFERRED'
          ? 'möbliert bevorzugt'
          : 'egal';
    case 'wbs':
      return values.wbs === 'AVAILABLE' ? 'WBS vorhanden' : values.wbs === 'NOT_AVAILABLE' ? 'kein WBS' : 'unbekannt';
    case 'minLivingSpace':
      return values.minLivingSpace != null ? `≥ ${values.minLivingSpace} m²` : '—';
    case 'availableFrom':
      return values.availableFrom ? values.availableFrom.toISOString().slice(0, 10) : '—';
    case 'pets':
      return values.pets ?? '—';
  }
}

function adviceFor(quality: MappingQuality): string {
  switch (quality) {
    case 'EXACT':
      return 'Filter im Portal 1:1 setzen.';
    case 'APPROXIMATE':
      return 'Portal-Filter breiter setzen; Frese Wohnung filtert nach Import exakt.';
    case 'MANUAL':
      return 'Nicht als Filter — nach Import in Frese Wohnung prüfen.';
    case 'UNSUPPORTED':
      return 'Portal kann diesen Filter nicht — nach Import in Frese Wohnung prüfen.';
    case 'UNKNOWN':
      return 'Mapping noch nicht verifiziert — bitte manuell prüfen.';
  }
}

export function buildRecipe(values: CanonicalFilterValues, mapping: SourceMapping): Recipe {
  const filters: CanonicalFilterKey[] = [
    'location',
    'radiusKm',
    'commuteMinutes',
    'maxWarmmiete',
    'minRooms',
    'minLivingSpace',
    'propertyType',
    'furnished',
    'wbs',
    'availableFrom',
    'pets',
  ];

  const lines: RecipeLine[] = filters.map((filter) => {
    const entry = mapping[filter] ?? { quality: 'UNKNOWN' as const };
    return {
      filter,
      label: CANONICAL_FILTER_LABELS[filter],
      quality: entry.quality,
      portalLabel: entry.portalLabel ?? null,
      humanValue: formatValue(filter, values),
      advice: adviceFor(entry.quality),
    };
  });

  const exactCount = lines.filter((l) => l.quality === 'EXACT').length;
  const totalRelevant = lines.filter((l) => l.humanValue !== '—' && l.humanValue !== 'unbekannt').length;
  const headline =
    exactCount === totalRelevant
      ? 'Alle relevanten Filter werden vom Portal direkt unterstützt.'
      : `${exactCount}/${totalRelevant} Filter werden vom Portal exakt unterstützt — Rest manuell oder nach Import.`;

  return { lines, headline };
}

/**
 * Build a URL from a template like
 *   https://example.com/suche?ort={city}&preis={maxRentEuros}&zimmer={minRooms}
 * Unknown placeholders are left blank rather than left literal.
 */
export function buildSearchUrl(template: string, values: CanonicalFilterValues): string {
  const map: Record<string, string> = {
    city: values.location.city ?? '',
    postalCode: values.location.postalCode ?? '',
    address: values.location.address ?? '',
    radiusKm: values.radiusKm != null ? String(values.radiusKm) : '',
    maxRentEuros: String(Math.round(values.maxWarmmieteCents / 100)),
    minRooms: String(values.minRooms),
    minLivingSpace: values.minLivingSpace != null ? String(values.minLivingSpace) : '',
    furnished: values.furnished === 'REQUIRED' ? 'true' : '',
    availableFrom: values.availableFrom ? values.availableFrom.toISOString().slice(0, 10) : '',
  };
  return template.replace(/\{(\w+)\}/g, (_all, key: string) =>
    Object.prototype.hasOwnProperty.call(map, key) ? encodeURIComponent(map[key] ?? '') : '',
  );
}
