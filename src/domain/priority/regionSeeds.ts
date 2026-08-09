/**
 * Starting estimates for market difficulty, by postal prefix.
 *
 * IMPORTANT: these are explicitly *estimates*, not measurements. They exist so
 * a brand-new candidate in an unknown region gets a sensible Anfrage target on
 * day one. As soon as we have our own contacts in a region, the observed
 * success rate takes over (see computeMarketDifficulty).
 *
 * Two different things make a market hard, and both raise the number:
 *   - competition: many applicants per flat (big, tight cities),
 *   - scarcity: barely any online listings at all (rural areas).
 * The seedNote says which one applies, so nobody misreads the number.
 *
 * Admins can edit any of these later without a deployment.
 */

export interface RegionSeedEntry {
  key: string;
  label: string;
  seededDifficulty: number;
  seedNote: string;
}

export const REGION_SEEDS: RegionSeedEntry[] = [
  // --- very tight big-city markets (competition) --------------------------
  { key: '805', label: 'München Nord', seededDifficulty: 92, seedNote: 'Großstadt, sehr angespannter Markt' },
  { key: '806', label: 'München', seededDifficulty: 92, seedNote: 'Großstadt, sehr angespannter Markt' },
  { key: '807', label: 'München Süd', seededDifficulty: 90, seedNote: 'Großstadt, sehr angespannter Markt' },
  { key: '101', label: 'Berlin Mitte', seededDifficulty: 90, seedNote: 'Großstadt, sehr angespannter Markt' },
  { key: '104', label: 'Berlin Friedrichshain', seededDifficulty: 88, seedNote: 'Großstadt, sehr angespannter Markt' },
  { key: '603', label: 'Frankfurt am Main', seededDifficulty: 88, seedNote: 'Großstadt, sehr angespannter Markt' },
  { key: '203', label: 'Hamburg', seededDifficulty: 85, seedNote: 'Großstadt, angespannter Markt' },
  { key: '702', label: 'Stuttgart', seededDifficulty: 85, seedNote: 'Großstadt, angespannter Markt' },
  { key: '405', label: 'Düsseldorf', seededDifficulty: 80, seedNote: 'Großstadt, angespannter Markt' },
  { key: '507', label: 'Köln', seededDifficulty: 80, seedNote: 'Großstadt, angespannter Markt' },

  // --- mid-size cities ----------------------------------------------------
  { key: '740', label: 'Heilbronn', seededDifficulty: 58, seedNote: 'Mittelstadt, moderat angespannt' },
  { key: '749', label: 'Bad Rappenau / Kraichgau', seededDifficulty: 62, seedNote: 'Kleinstadt/ländlich, wenig Online-Angebot' },
  { key: '741', label: 'Heilbronn Umland', seededDifficulty: 60, seedNote: 'Umland, begrenztes Angebot' },
  { key: '681', label: 'Mannheim', seededDifficulty: 72, seedNote: 'Großstadt, angespannt' },
  { key: '691', label: 'Heidelberg', seededDifficulty: 80, seedNote: 'Universitätsstadt, sehr angespannt' },
  { key: '901', label: 'Nürnberg', seededDifficulty: 70, seedNote: 'Großstadt, angespannt' },
  { key: '040', label: 'Leipzig', seededDifficulty: 62, seedNote: 'Großstadt, zunehmend angespannt' },
  { key: '011', label: 'Dresden', seededDifficulty: 58, seedNote: 'Großstadt, moderat' },
  { key: '281', label: 'Bremen', seededDifficulty: 60, seedNote: 'Großstadt, moderat' },
  { key: '301', label: 'Hannover', seededDifficulty: 66, seedNote: 'Großstadt, angespannt' },
  { key: '441', label: 'Dortmund', seededDifficulty: 55, seedNote: 'Ruhrgebiet, entspannter' },
  { key: '451', label: 'Essen', seededDifficulty: 55, seedNote: 'Ruhrgebiet, entspannter' },

  // --- rural / remote: few listings, not much competition -----------------
  { key: '170', label: 'Neubrandenburg / Mecklenburg', seededDifficulty: 76, seedNote: 'Ländlich, wenig Online-Angebot' },
  { key: '171', label: 'Mecklenburg Ost', seededDifficulty: 78, seedNote: 'Sehr ländlich, kaum Online-Inserate' },
  { key: '175', label: 'Mecklenburgische Seenplatte', seededDifficulty: 78, seedNote: 'Sehr ländlich, kaum Online-Inserate' },
  { key: '396', label: 'Altmark', seededDifficulty: 78, seedNote: 'Sehr ländlich, kaum Online-Inserate' },
  { key: '074', label: 'Ostthüringen ländlich', seededDifficulty: 72, seedNote: 'Ländlich, wenig Online-Angebot' },
  { key: '946', label: 'Bayerischer Wald', seededDifficulty: 76, seedNote: 'Sehr ländlich, kaum Online-Inserate' },
  { key: '498', label: 'Ostwestfalen ländlich', seededDifficulty: 70, seedNote: 'Ländlich, wenig Online-Angebot' },
];

/**
 * Fallback when a postal prefix is not seeded. Neutral on purpose: the model
 * should not pretend to know a region it has never seen.
 */
export const DEFAULT_REGION_SEED = {
  seededDifficulty: 55,
  seedNote: 'Keine Startschätzung hinterlegt — neutraler Ausgangswert',
};
