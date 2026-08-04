/**
 * Canonical, portal-independent filter keys. Every source declares how well it
 * supports each of these; the search-run planner uses that mapping to build a
 * per-source task and recipe. Adding a new filter here is a deliberate
 * product decision, so keep the list short.
 */

export const CANONICAL_FILTERS = {
  location: 'location',
  radiusKm: 'radiusKm',
  commuteMinutes: 'commuteMinutes',
  maxWarmmiete: 'maxWarmmiete',
  minRooms: 'minRooms',
  propertyType: 'propertyType',
  furnished: 'furnished',
  wbs: 'wbs',
  minLivingSpace: 'minLivingSpace',
  availableFrom: 'availableFrom',
  pets: 'pets',
} as const;

export type CanonicalFilterKey = (typeof CANONICAL_FILTERS)[keyof typeof CANONICAL_FILTERS];

export const CANONICAL_FILTER_LABELS: Record<CanonicalFilterKey, string> = {
  location: 'Ort / PLZ',
  radiusKm: 'Umkreis (km)',
  commuteMinutes: 'Max. Anfahrtszeit',
  maxWarmmiete: 'Max. Warmmiete',
  minRooms: 'Min. Zimmer',
  propertyType: 'Objekttyp',
  furnished: 'Möbliert',
  wbs: 'WBS',
  minLivingSpace: 'Min. Fläche',
  availableFrom: 'Verfügbar ab',
  pets: 'Haustiere',
};
