/**
 * Seed catalogue of housing sources. All connectors default to their honest
 * fallback (SEARCH_LINK / MANUAL_IMPORT / BROWSER_ONLY): the seed file makes
 * no claim of authorised automated ingestion for any portal.
 *
 * Terms review status is deliberately set to NOT_REVIEWED / MANUAL_ONLY for
 * everything below — enabling any automated behaviour requires an admin to
 * check the source's current official terms and flip termsReviewStatus to
 * APPROVED_FOR_AUTOMATION explicitly.
 */

export interface SeedSource {
  key: string;
  name: string;
  websiteUrl: string;
  familyKey?: string;
  category:
    | 'MARKETPLACE'
    | 'GENERAL_PORTAL'
    | 'FURNISHED'
    | 'INSTITUTIONAL_LANDLORD'
    | 'COOPERATIVE'
    | 'MUNICIPAL'
    | 'TEMPORARY'
    | 'SOCIAL_LOCAL'
    | 'DIRECTORY';
  priority: number;
  integrationMode:
    | 'OFFICIAL_API'
    | 'EMAIL_ALERT'
    | 'SEARCH_LINK'
    | 'MANUAL_IMPORT'
    | 'BROWSER_ONLY'
    | 'REGIONAL_DIRECTORY'
    | 'CUSTOM_SOURCE';
  temporaryOnly?: boolean;
  housingTypes: string[];
  coverage: Array<{ kind: 'NATIONWIDE' | 'STATE' | 'CITY' | 'POSTAL_PREFIX'; value: string }>;
  aliases?: string[];
  filterMappings: Array<{
    canonicalFilter: string;
    quality: 'EXACT' | 'APPROXIMATE' | 'MANUAL' | 'UNSUPPORTED' | 'UNKNOWN';
    portalLabel?: string;
    note?: string;
  }>;
  manualRecipe?: string;
  notes?: string;
}

export interface SeedFamily {
  key: string;
  name: string;
  notes?: string;
}

export const SEED_FAMILIES: SeedFamily[] = [
  { key: 'immoscout', name: 'ImmoScout24' },
  { key: 'immowelt', name: 'Immowelt' , notes: 'Immonet-Inventar wurde weitgehend integriert; separat als Alias führen.' },
  { key: 'kleinanzeigen', name: 'Kleinanzeigen' },
  { key: 'wggesucht', name: 'WG-Gesucht' },
  { key: 'housinganywhere', name: 'HousingAnywhere' },
  { key: 'wunderflats', name: 'Wunderflats' },
];

// A defensive mapping used for most large German marketplaces — Ort/PLZ exakt,
// Preis approximativ (meist Warmmiete unsupported), Zimmer exakt.
const bigMarketplaceMapping: SeedSource['filterMappings'] = [
  { canonicalFilter: 'location', quality: 'EXACT', portalLabel: 'Ort/PLZ' },
  { canonicalFilter: 'radiusKm', quality: 'EXACT', portalLabel: 'Umkreis' },
  { canonicalFilter: 'commuteMinutes', quality: 'UNSUPPORTED', note: 'Portal kennt keine Anfahrtszeit — Umkreis nutzen.' },
  { canonicalFilter: 'maxWarmmiete', quality: 'APPROXIMATE', portalLabel: 'Kaltmiete bis', note: 'Portal filtert i.d.R. nach Kaltmiete — breiter suchen und nach Import Warmmiete prüfen.' },
  { canonicalFilter: 'minRooms', quality: 'EXACT', portalLabel: 'Zimmer ab' },
  { canonicalFilter: 'minLivingSpace', quality: 'EXACT', portalLabel: 'Wohnfläche ab' },
  { canonicalFilter: 'propertyType', quality: 'EXACT', portalLabel: 'Wohnungstyp' },
  { canonicalFilter: 'furnished', quality: 'APPROXIMATE', note: 'Möblierung wird meist nur im Text angegeben — nach Import prüfen.' },
  { canonicalFilter: 'wbs', quality: 'MANUAL', note: 'WBS-Pflicht nur im Text — nach Import prüfen.' },
  { canonicalFilter: 'availableFrom', quality: 'MANUAL', note: 'Verfügbar-Ab nach Import prüfen.' },
  { canonicalFilter: 'pets', quality: 'MANUAL', note: 'Haustierklausel nur im Text — nach Import prüfen.' },
];

const municipalMapping: SeedSource['filterMappings'] = [
  { canonicalFilter: 'location', quality: 'EXACT', portalLabel: 'Stadtteil/PLZ' },
  { canonicalFilter: 'radiusKm', quality: 'UNSUPPORTED' },
  { canonicalFilter: 'commuteMinutes', quality: 'UNSUPPORTED' },
  { canonicalFilter: 'maxWarmmiete', quality: 'APPROXIMATE', portalLabel: 'Miete bis' },
  { canonicalFilter: 'minRooms', quality: 'EXACT' },
  { canonicalFilter: 'minLivingSpace', quality: 'APPROXIMATE' },
  { canonicalFilter: 'propertyType', quality: 'EXACT' },
  { canonicalFilter: 'furnished', quality: 'UNSUPPORTED', note: 'Institutionelle Vermieter bieten selten möblierte Wohnungen — Möblierung nach Import prüfen.' },
  { canonicalFilter: 'wbs', quality: 'MANUAL', note: 'Häufig WBS-Pflicht — bitte Text prüfen.' },
  { canonicalFilter: 'availableFrom', quality: 'MANUAL' },
  { canonicalFilter: 'pets', quality: 'MANUAL' },
];

const furnishedMapping: SeedSource['filterMappings'] = [
  { canonicalFilter: 'location', quality: 'EXACT' },
  { canonicalFilter: 'radiusKm', quality: 'APPROXIMATE' },
  { canonicalFilter: 'commuteMinutes', quality: 'UNSUPPORTED' },
  { canonicalFilter: 'maxWarmmiete', quality: 'APPROXIMATE', note: 'Möblierte Anbieter kalkulieren häufig inkl. Nebenkosten — Filter setzt oft Gesamtmiete.' },
  { canonicalFilter: 'minRooms', quality: 'APPROXIMATE' },
  { canonicalFilter: 'minLivingSpace', quality: 'APPROXIMATE' },
  { canonicalFilter: 'propertyType', quality: 'EXACT' },
  { canonicalFilter: 'furnished', quality: 'EXACT', note: 'Portalspezifisch praktisch immer möbliert.' },
  { canonicalFilter: 'wbs', quality: 'UNSUPPORTED' },
  { canonicalFilter: 'availableFrom', quality: 'EXACT' },
  { canonicalFilter: 'pets', quality: 'MANUAL' },
];

const socialLocalMapping: SeedSource['filterMappings'] = [
  { canonicalFilter: 'location', quality: 'APPROXIMATE' },
  { canonicalFilter: 'radiusKm', quality: 'UNSUPPORTED' },
  { canonicalFilter: 'commuteMinutes', quality: 'UNSUPPORTED' },
  { canonicalFilter: 'maxWarmmiete', quality: 'MANUAL' },
  { canonicalFilter: 'minRooms', quality: 'MANUAL' },
  { canonicalFilter: 'minLivingSpace', quality: 'MANUAL' },
  { canonicalFilter: 'propertyType', quality: 'MANUAL' },
  { canonicalFilter: 'furnished', quality: 'MANUAL' },
  { canonicalFilter: 'wbs', quality: 'MANUAL' },
  { canonicalFilter: 'availableFrom', quality: 'MANUAL' },
  { canonicalFilter: 'pets', quality: 'MANUAL' },
];

// -------------------------------------------------------------- catalogue

export const SEED_SOURCES: SeedSource[] = [
  // ---- German marketplaces
  {
    key: 'immoscout24',
    name: 'ImmoScout24',
    websiteUrl: 'https://www.immobilienscout24.de/',
    familyKey: 'immoscout',
    category: 'MARKETPLACE',
    priority: 10,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: bigMarketplaceMapping,
    notes: 'Kommerzielle API nur für Business-Kunden. Kein Scraping ohne Freigabe.',
  },
  {
    key: 'immowelt',
    name: 'Immowelt',
    websiteUrl: 'https://www.immowelt.de/',
    familyKey: 'immowelt',
    category: 'MARKETPLACE',
    priority: 20,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    aliases: ['Immonet'],
    filterMappings: bigMarketplaceMapping,
    notes: 'Inventar von Immonet ist inzwischen weitgehend in die Immowelt-Familie überführt.',
  },
  {
    key: 'kleinanzeigen',
    name: 'Kleinanzeigen',
    websiteUrl: 'https://www.kleinanzeigen.de/s-wohnung-mieten/',
    familyKey: 'kleinanzeigen',
    category: 'MARKETPLACE',
    priority: 25,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    aliases: ['eBay Kleinanzeigen'],
    filterMappings: bigMarketplaceMapping,
    notes: 'Kein offizieller Vermietungs-API-Zugriff — Suche + manueller Import.',
  },
  {
    key: 'wg-gesucht',
    name: 'WG-Gesucht (nur Wohnungen)',
    websiteUrl: 'https://www.wg-gesucht.de/',
    familyKey: 'wggesucht',
    category: 'MARKETPLACE',
    priority: 40,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    aliases: ['wg-suche.de'],
    filterMappings: bigMarketplaceMapping,
    manualRecipe: 'Auf WG-Gesucht ausschließlich "1-Zimmer-Wohnungen" und "Wohnungen" wählen — WG-Zimmer ausschließen.',
  },
  {
    key: 'meinestadt',
    name: 'meinestadt.de Immobilien',
    websiteUrl: 'https://immobilien.meinestadt.de/',
    category: 'GENERAL_PORTAL',
    priority: 60,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: bigMarketplaceMapping,
  },
  {
    key: 'ohne-makler',
    name: 'ohne-makler.net',
    websiteUrl: 'https://www.ohne-makler.net/',
    category: 'GENERAL_PORTAL',
    priority: 70,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: bigMarketplaceMapping,
  },
  {
    key: 'immobilo',
    name: 'immobilo',
    websiteUrl: 'https://www.immobilo.de/',
    category: 'GENERAL_PORTAL',
    priority: 75,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: bigMarketplaceMapping,
  },
  {
    key: 'wohnungsboerse',
    name: 'Wohnungsbörse',
    websiteUrl: 'https://www.wohnungsboerse.net/',
    category: 'GENERAL_PORTAL',
    priority: 80,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: bigMarketplaceMapping,
  },

  // ---- Furnished / relocation
  {
    key: 'wunderflats',
    name: 'Wunderflats',
    websiteUrl: 'https://wunderflats.com/',
    familyKey: 'wunderflats',
    category: 'FURNISHED',
    priority: 15,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: furnishedMapping,
  },
  {
    key: 'housinganywhere',
    name: 'HousingAnywhere',
    websiteUrl: 'https://housinganywhere.com/',
    familyKey: 'housinganywhere',
    category: 'FURNISHED',
    priority: 18,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    aliases: ['Studenten-WG.de'],
    filterMappings: furnishedMapping,
  },
  {
    key: 'spotahome',
    name: 'Spotahome',
    websiteUrl: 'https://www.spotahome.com/',
    category: 'FURNISHED',
    priority: 30,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: furnishedMapping,
  },
  {
    key: 'hc24',
    name: 'HC24',
    websiteUrl: 'https://www.hc24.de/',
    category: 'FURNISHED',
    priority: 45,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: furnishedMapping,
  },
  {
    key: 'mrlodge',
    name: 'Mr. Lodge',
    websiteUrl: 'https://www.mrlodge.de/',
    category: 'FURNISHED',
    priority: 90,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [
      { kind: 'CITY', value: 'München' },
      { kind: 'STATE', value: 'Bayern' },
    ],
    filterMappings: furnishedMapping,
  },

  // ---- Institutional landlords
  {
    key: 'vonovia',
    name: 'Vonovia',
    websiteUrl: 'https://www.vonovia.de/de-de/mieten',
    category: 'INSTITUTIONAL_LANDLORD',
    priority: 50,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: municipalMapping,
  },
  {
    key: 'leg',
    name: 'LEG Wohnen',
    websiteUrl: 'https://www.leg-wohnen.de/mieten/',
    category: 'INSTITUTIONAL_LANDLORD',
    priority: 55,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'STATE', value: 'Nordrhein-Westfalen' }],
    filterMappings: municipalMapping,
  },
  {
    key: 'tag',
    name: 'TAG Wohnen',
    websiteUrl: 'https://www.tag-wohnen.de/mieten/',
    category: 'INSTITUTIONAL_LANDLORD',
    priority: 65,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: municipalMapping,
  },

  // ---- Municipal / regional (relevant for the acceptance scenario in BW)
  {
    key: 'gwg-bw',
    name: 'Städtische Wohnungsbaugesellschaft BW (Sammel-Directory)',
    websiteUrl: 'https://www.wohnraum-bw.de/',
    category: 'DIRECTORY',
    priority: 100,
    integrationMode: 'REGIONAL_DIRECTORY',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'STATE', value: 'Baden-Württemberg' }],
    filterMappings: municipalMapping,
    manualRecipe: 'Kreis Heilbronn und angrenzende Kommunen einzeln prüfen — jede Genossenschaft hat eigenes Formular.',
  },
  {
    key: 'stadt-bad-rappenau',
    name: 'Stadt Bad Rappenau — Wohnraumhinweise',
    websiteUrl: 'https://www.bad-rappenau.de/',
    category: 'MUNICIPAL',
    priority: 110,
    integrationMode: 'BROWSER_ONLY',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'POSTAL_PREFIX', value: '74906' }],
    filterMappings: socialLocalMapping,
    manualRecipe: 'Aushänge und Immobilien-Rubrik der Stadt prüfen, danach ggf. bei Verwaltung nachfragen.',
  },
  {
    key: 'wohnbau-heilbronn',
    name: 'Stadtsiedlung Heilbronn',
    websiteUrl: 'https://www.stadtsiedlung.de/',
    category: 'MUNICIPAL',
    priority: 105,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [
      { kind: 'CITY', value: 'Heilbronn' },
      { kind: 'POSTAL_PREFIX', value: '741' },
      { kind: 'POSTAL_PREFIX', value: '749' },
    ],
    filterMappings: municipalMapping,
  },

  // ---- Regional newspaper / social / community
  {
    key: 'heilbronner-stimme',
    name: 'Heilbronner Stimme — Immobilienmarkt',
    websiteUrl: 'https://immo.stimme.de/',
    category: 'GENERAL_PORTAL',
    priority: 120,
    integrationMode: 'SEARCH_LINK',
    housingTypes: ['APARTMENT'],
    coverage: [
      { kind: 'CITY', value: 'Heilbronn' },
      { kind: 'POSTAL_PREFIX', value: '74' },
    ],
    filterMappings: bigMarketplaceMapping,
  },
  {
    key: 'nebenan',
    name: 'nebenan.de (Nachbarschafts-Hinweise)',
    websiteUrl: 'https://nebenan.de/',
    category: 'SOCIAL_LOCAL',
    priority: 130,
    integrationMode: 'BROWSER_ONLY',
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: socialLocalMapping,
    manualRecipe: 'Nur in der Rolle des Kandidaten oder mit ausdrücklicher Zustimmung nutzen — nichts posten.',
  },

  // ---- Temporary / emergency
  {
    key: 'monteurzimmer',
    name: 'Monteurzimmer.de',
    websiteUrl: 'https://www.monteurzimmer.de/',
    category: 'TEMPORARY',
    priority: 200,
    integrationMode: 'SEARCH_LINK',
    temporaryOnly: true,
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: [
      ...furnishedMapping.map((f) =>
        f.canonicalFilter === 'furnished' ? { ...f, quality: 'EXACT' as const } : f,
      ),
    ],
    manualRecipe: 'Nur im Notfall-Modus einsetzen. Anmeldung und echte Monatskosten explizit klären.',
  },
  {
    key: 'booking-extended',
    name: 'Booking.com — Extended Stays',
    websiteUrl: 'https://www.booking.com/',
    category: 'TEMPORARY',
    priority: 210,
    integrationMode: 'BROWSER_ONLY',
    temporaryOnly: true,
    housingTypes: ['APARTMENT'],
    coverage: [{ kind: 'NATIONWIDE', value: '' }],
    filterMappings: socialLocalMapping,
    manualRecipe:
      'Anmeldung/Wohnungsgeberbestätigung sind meist NICHT möglich — nur als Notlösung, immer explizit vermerken.',
  },
];
