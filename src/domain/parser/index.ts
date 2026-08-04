/**
 * Deterministic parser for German-language rental listings.
 *
 * Design:
 *  - Input is the raw title + description (structured hints may be passed too).
 *  - Output is an ExtractedFacts object plus a list of ExtractionEvidence
 *    entries. Facts and evidence are stored side-by-side in the DB, so a user
 *    who overrides a value can still see where the previous value came from.
 *  - Confidence is coarse: 1.0 = structured or explicit label, 0.7 = strong
 *    phrase, 0.4 = weak phrase / inferred. It is *not* a probability.
 */

import {
  ABLOESE_AMOUNT_PATTERN,
  ANMELDUNG_NO_PATTERNS,
  ANMELDUNG_YES_PATTERNS,
  AVAILABLE_FROM_PATTERNS,
  AVAILABLE_NOW_PATTERNS,
  EXCHANGE_PATTERNS,
  FITTED_KITCHEN_PATTERNS,
  FIXED_TERM_PATTERNS,
  FULLY_FURNISHED_PATTERNS,
  FURNISHED_HINT_PATTERNS,
  FURNITURE_TAKEOVER_PATTERNS,
  GUARANTOR_PATTERNS,
  HEIZKOSTEN_PATTERN,
  INCOME_PROOF_PATTERNS,
  KALTMIETE_LABEL_PATTERN,
  KALTMIETE_PATTERN,
  KAUTION_PATTERN,
  LIVING_SPACE_PATTERN,
  MAX_DURATION_PATTERN,
  MIN_DURATION_PATTERN,
  NEBENKOSTEN_PATTERN,
  NETTOKALT_PATTERN,
  PARTIALLY_FURNISHED_PATTERNS,
  PETS_NO_PATTERNS,
  PETS_YES_PATTERNS,
  PROVISION_PATTERN,
  PROVISIONSFREI_PATTERN,
  PROPERTY_APARTMENT_PATTERNS,
  PROPERTY_FOR_SALE_PATTERNS,
  PROPERTY_HOUSE_PATTERNS,
  PROPERTY_TEMPORARY_PATTERNS,
  PROPERTY_WG_PATTERNS,
  ROOMS_PATTERN,
  SCHUFA_PATTERNS,
  UNFURNISHED_PATTERNS,
  WARMMIETE_LABEL_PATTERN,
  WARMMIETE_PATTERN,
  WBS_PATTERNS,
  WOHNUNGSGEBER_PATTERNS,
} from './patterns';
import { containsAny, evidenceAround, normaliseText } from '@/lib/text';
import { parseGermanAmountToCents } from '@/lib/money';

export const EXTRACTOR_VERSION = 'parser-2026-08-04';

export type Furnishing =
  | 'FULLY_FURNISHED'
  | 'FURNISHED'
  | 'PARTIALLY_FURNISHED'
  | 'FURNITURE_TAKEOVER'
  | 'UNFURNISHED'
  | 'UNKNOWN';

export type PropertyType =
  | 'APARTMENT'
  | 'WG_ROOM'
  | 'HOUSE'
  | 'FOR_SALE'
  | 'EXCHANGE'
  | 'TEMPORARY'
  | 'COMMERCIAL'
  | 'PARKING'
  | 'OTHER'
  | 'UNKNOWN';

export type TriState = 'YES' | 'NO' | 'UNKNOWN';

export interface StructuredHints {
  warmMieteCents?: number | null;
  kaltMieteCents?: number | null;
  nebenkostenCents?: number | null;
  rooms?: number | null;
  livingSpaceSqm?: number | null;
  propertyTypeHint?: PropertyType;
  furnishingHint?: Furnishing;
}

export interface ExtractedEvidence {
  key: string;
  origin: 'DESCRIPTION' | 'TITLE' | 'STRUCTURED_FIELD' | 'DERIVED';
  snippet: string | null;
  confidence: number;
}

export interface ExtractedFacts {
  propertyType: PropertyType;
  furnishing: Furnishing;
  fittedKitchen: TriState;

  warmMieteCents: number | null;
  kaltMieteCents: number | null;
  nebenkostenCents: number | null;
  heizkostenCents: number | null;
  depositCents: number | null;
  abloeseCents: number | null;
  provisionNote: string | null;
  /** Best known monthly total, computed conservatively. */
  effectiveMonthlyCents: number | null;
  monthlyTotalComplete: boolean;

  rooms: number | null;
  livingSpaceSqm: number | null;
  availableNow: boolean;
  availableFrom: Date | null;

  wbsRequired: TriState;
  exchangeRequired: TriState;
  petsAllowed: TriState;
  fixedTerm: TriState;
  minDurationMonths: number | null;
  maxDurationMonths: number | null;
  anmeldungPossible: TriState;

  warnings: string[];
  evidence: ExtractedEvidence[];
  extractorVersion: string;
}

interface ParserInput {
  title: string;
  description: string;
  structured?: StructuredHints;
}

// -------------------------------------------------------- small helpers

function pushEvidence(
  out: ExtractedEvidence[],
  key: string,
  origin: ExtractedEvidence['origin'],
  snippet: string | null,
  confidence: number,
) {
  out.push({ key, origin, snippet, confidence });
}

function firstMatchAmount(text: string, patterns: RegExp[]): { cents: number | null; snippet: string | null } {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m[1]) {
      const cents = parseGermanAmountToCents(m[1]);
      if (cents != null) return { cents, snippet: evidenceAround(text, re) };
    }
  }
  return { cents: null, snippet: null };
}

function detectPropertyType(text: string, title: string, hint?: PropertyType): PropertyType {
  if (hint && hint !== 'UNKNOWN') return hint;

  const haystack = `${title}\n${text}`;

  if (containsAny(haystack, PROPERTY_FOR_SALE_PATTERNS)) return 'FOR_SALE';
  if (containsAny(haystack, PROPERTY_WG_PATTERNS)) return 'WG_ROOM';
  if (containsAny(haystack, PROPERTY_TEMPORARY_PATTERNS)) return 'TEMPORARY';
  if (containsAny(haystack, PROPERTY_HOUSE_PATTERNS)) return 'HOUSE';
  if (containsAny(haystack, EXCHANGE_PATTERNS)) return 'EXCHANGE';
  if (containsAny(haystack, PROPERTY_APARTMENT_PATTERNS)) return 'APARTMENT';
  return 'UNKNOWN';
}

function detectFurnishing(
  text: string,
  title: string,
  evidence: ExtractedEvidence[],
  hint?: Furnishing,
): Furnishing {
  if (hint && hint !== 'UNKNOWN') return hint;

  const haystack = `${title}\n${text}`;

  // Explicit negation always wins.
  for (const re of UNFURNISHED_PATTERNS) {
    if (re.test(haystack)) {
      pushEvidence(evidence, 'furnishing', 'DESCRIPTION', evidenceAround(haystack, re), 0.95);
      return 'UNFURNISHED';
    }
  }

  for (const re of FULLY_FURNISHED_PATTERNS) {
    if (re.test(haystack)) {
      pushEvidence(evidence, 'furnishing', 'DESCRIPTION', evidenceAround(haystack, re), 0.9);
      return 'FULLY_FURNISHED';
    }
  }

  for (const re of PARTIALLY_FURNISHED_PATTERNS) {
    if (re.test(haystack)) {
      pushEvidence(evidence, 'furnishing', 'DESCRIPTION', evidenceAround(haystack, re), 0.85);
      return 'PARTIALLY_FURNISHED';
    }
  }

  // Furniture takeover: the apartment ships without furniture unless the
  // tenant pays. We classify it as its own state (FURNITURE_TAKEOVER) and
  // surface the fee separately.
  for (const re of FURNITURE_TAKEOVER_PATTERNS) {
    if (re.test(haystack)) {
      pushEvidence(evidence, 'furnishing', 'DESCRIPTION', evidenceAround(haystack, re), 0.8);
      return 'FURNITURE_TAKEOVER';
    }
  }

  for (const re of FURNISHED_HINT_PATTERNS) {
    if (re.test(haystack)) {
      // "möbliert" alone, no qualifier: assume furnished but leave lower conf.
      pushEvidence(evidence, 'furnishing', 'DESCRIPTION', evidenceAround(haystack, re), 0.7);
      return 'FURNISHED';
    }
  }

  return 'UNKNOWN';
}

function detectFittedKitchen(text: string, evidence: ExtractedEvidence[]): TriState {
  for (const re of FITTED_KITCHEN_PATTERNS) {
    if (re.test(text)) {
      pushEvidence(evidence, 'fittedKitchen', 'DESCRIPTION', evidenceAround(text, re), 0.9);
      return 'YES';
    }
  }
  return 'UNKNOWN';
}

function detectTriState(
  text: string,
  yesPatterns: RegExp[],
  noPatterns: RegExp[],
  key: string,
  evidence: ExtractedEvidence[],
): TriState {
  for (const re of noPatterns) {
    if (re.test(text)) {
      pushEvidence(evidence, key, 'DESCRIPTION', evidenceAround(text, re), 0.9);
      return 'NO';
    }
  }
  for (const re of yesPatterns) {
    if (re.test(text)) {
      pushEvidence(evidence, key, 'DESCRIPTION', evidenceAround(text, re), 0.9);
      return 'YES';
    }
  }
  return 'UNKNOWN';
}

function detectAvailability(
  text: string,
  evidence: ExtractedEvidence[],
): { availableNow: boolean; availableFrom: Date | null } {
  for (const re of AVAILABLE_NOW_PATTERNS) {
    if (re.test(text)) {
      pushEvidence(evidence, 'availableNow', 'DESCRIPTION', evidenceAround(text, re), 0.9);
      return { availableNow: true, availableFrom: null };
    }
  }
  for (const re of AVAILABLE_FROM_PATTERNS) {
    const m = re.exec(text);
    if (m && m[1]) {
      const parsed = parseGermanDate(m[1]);
      if (parsed) {
        pushEvidence(evidence, 'availableFrom', 'DESCRIPTION', evidenceAround(text, re), 0.85);
        return { availableNow: false, availableFrom: parsed };
      }
    }
  }
  return { availableNow: false, availableFrom: null };
}

function parseGermanDate(raw: string): Date | null {
  // DD.MM.YYYY (or YY)
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(raw);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month, day));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  // MM/YYYY
  m = /^(\d{1,2})\/(\d{4})$/.exec(raw);
  if (m) {
    const month = Number(m[1]) - 1;
    const year = Number(m[2]);
    return new Date(Date.UTC(year, month, 1));
  }
  // ISO
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}

// -------------------------------------------------------- main entry

export function parseListing(input: ParserInput): ExtractedFacts {
  const description = normaliseText(input.description ?? '');
  const title = normaliseText(input.title ?? '');
  const structured = input.structured ?? {};
  const evidence: ExtractedEvidence[] = [];

  // -- property type
  const propertyType = detectPropertyType(description, title, structured.propertyTypeHint);
  pushEvidence(evidence, 'propertyType', 'DERIVED', propertyType, propertyType === 'UNKNOWN' ? 0.3 : 0.7);

  // -- furnishing
  const furnishing = detectFurnishing(description, title, evidence, structured.furnishingHint);
  const fittedKitchen = detectFittedKitchen(description, evidence);

  // -- costs (structured wins over free-text, but we still surface evidence)
  const warmFromText = firstMatchAmount(description, [WARMMIETE_PATTERN, WARMMIETE_LABEL_PATTERN]);
  const kaltFromText = firstMatchAmount(description, [KALTMIETE_PATTERN, KALTMIETE_LABEL_PATTERN, NETTOKALT_PATTERN]);
  const nkFromText = firstMatchAmount(description, [NEBENKOSTEN_PATTERN]);
  const heizFromText = firstMatchAmount(description, [HEIZKOSTEN_PATTERN]);
  const kautionFromText = firstMatchAmount(description, [KAUTION_PATTERN]);
  const abloeseFromText = firstMatchAmount(description, [ABLOESE_AMOUNT_PATTERN]);

  const warmMieteCents = structured.warmMieteCents ?? warmFromText.cents;
  const kaltMieteCents = structured.kaltMieteCents ?? kaltFromText.cents;
  const nebenkostenCents = structured.nebenkostenCents ?? nkFromText.cents;
  const heizkostenCents = heizFromText.cents;
  const depositCents = kautionFromText.cents;
  const abloeseCents = abloeseFromText.cents;

  if (warmMieteCents != null) {
    pushEvidence(
      evidence,
      'warmMieteCents',
      structured.warmMieteCents != null ? 'STRUCTURED_FIELD' : 'DESCRIPTION',
      warmFromText.snippet,
      structured.warmMieteCents != null ? 1 : 0.9,
    );
  }
  if (kaltMieteCents != null) {
    pushEvidence(
      evidence,
      'kaltMieteCents',
      structured.kaltMieteCents != null ? 'STRUCTURED_FIELD' : 'DESCRIPTION',
      kaltFromText.snippet,
      structured.kaltMieteCents != null ? 1 : 0.9,
    );
  }
  if (nebenkostenCents != null) {
    pushEvidence(evidence, 'nebenkostenCents', 'DESCRIPTION', nkFromText.snippet, 0.9);
  }
  if (heizkostenCents != null) {
    pushEvidence(evidence, 'heizkostenCents', 'DESCRIPTION', heizFromText.snippet, 0.9);
  }
  if (depositCents != null) {
    pushEvidence(evidence, 'depositCents', 'DESCRIPTION', kautionFromText.snippet, 0.9);
  }
  if (abloeseCents != null) {
    pushEvidence(evidence, 'abloeseCents', 'DESCRIPTION', abloeseFromText.snippet, 0.9);
  }

  const provisionfrei = PROVISIONSFREI_PATTERN.test(description);
  const provisionMentioned = PROVISION_PATTERN.test(description);
  const provisionNote = provisionfrei
    ? 'provisionsfrei'
    : provisionMentioned
      ? 'Provision im Text erwähnt — bitte prüfen'
      : null;

  // -- monthly total
  let effectiveMonthlyCents: number | null = null;
  let monthlyTotalComplete = false;
  if (warmMieteCents != null) {
    effectiveMonthlyCents = warmMieteCents;
    monthlyTotalComplete = true;
  } else if (kaltMieteCents != null && (nebenkostenCents != null || heizkostenCents != null)) {
    effectiveMonthlyCents = kaltMieteCents + (nebenkostenCents ?? 0) + (heizkostenCents ?? 0);
    // Only "complete" if BOTH additional cost lines exist. Otherwise it's a
    // conservative lower bound.
    monthlyTotalComplete = nebenkostenCents != null && heizkostenCents != null;
  } else if (kaltMieteCents != null) {
    // We know Kaltmiete only — this is *not* the true monthly cost. Store it
    // as effective for coarse sorting, but flag as incomplete.
    effectiveMonthlyCents = kaltMieteCents;
    monthlyTotalComplete = false;
  }

  // -- rooms & area
  const roomsFromText = ROOMS_PATTERN.exec(`${title}\n${description}`);
  const rooms =
    structured.rooms != null
      ? structured.rooms
      : roomsFromText
        ? Number(roomsFromText[1].replace(',', '.'))
        : null;
  if (rooms != null) {
    pushEvidence(
      evidence,
      'rooms',
      structured.rooms != null ? 'STRUCTURED_FIELD' : 'TITLE',
      roomsFromText ? evidenceAround(`${title}\n${description}`, ROOMS_PATTERN) : String(rooms),
      structured.rooms != null ? 1 : 0.85,
    );
  }

  const spaceFromText = LIVING_SPACE_PATTERN.exec(`${title}\n${description}`);
  const livingSpaceSqm =
    structured.livingSpaceSqm != null
      ? structured.livingSpaceSqm
      : spaceFromText
        ? Number(spaceFromText[1].replace(',', '.'))
        : null;
  if (livingSpaceSqm != null) {
    pushEvidence(
      evidence,
      'livingSpaceSqm',
      structured.livingSpaceSqm != null ? 'STRUCTURED_FIELD' : 'DESCRIPTION',
      spaceFromText ? evidenceAround(`${title}\n${description}`, LIVING_SPACE_PATTERN) : String(livingSpaceSqm),
      0.9,
    );
  }

  // -- availability
  const availability = detectAvailability(description, evidence);

  // -- restrictions / warnings
  const wbsRequired = detectTriState(description, WBS_PATTERNS, [], 'wbsRequired', evidence);
  const exchangeRequired = detectTriState(description, EXCHANGE_PATTERNS, [], 'exchangeRequired', evidence);
  const anmeldungPossible = detectTriState(
    description,
    ANMELDUNG_YES_PATTERNS,
    ANMELDUNG_NO_PATTERNS,
    'anmeldungPossible',
    evidence,
  );
  const petsAllowed = detectTriState(description, PETS_YES_PATTERNS, PETS_NO_PATTERNS, 'petsAllowed', evidence);
  const fixedTerm = detectTriState(description, FIXED_TERM_PATTERNS, [], 'fixedTerm', evidence);

  const minDurMatch = MIN_DURATION_PATTERN.exec(description);
  const maxDurMatch = MAX_DURATION_PATTERN.exec(description);
  const minDurationMonths = minDurMatch ? Number(minDurMatch[2]) : null;
  const maxDurationMonths = maxDurMatch ? Number(maxDurMatch[1]) : null;

  const warnings: string[] = [];
  if (wbsRequired === 'YES') warnings.push('WBS/Wohnberechtigungsschein erforderlich');
  if (exchangeRequired === 'YES') warnings.push('Tauschwohnung — Wohnungstausch erwartet');
  if (fixedTerm === 'YES') warnings.push('Zeitlich befristeter Mietvertrag');
  if (anmeldungPossible === 'NO') warnings.push('Anmeldung nicht möglich');
  if (containsAny(description, WOHNUNGSGEBER_PATTERNS)) warnings.push('Wohnungsgeberbestätigung explizit erwähnt');
  if (containsAny(description, SCHUFA_PATTERNS)) warnings.push('SCHUFA/Bonitätsauskunft verlangt');
  if (containsAny(description, INCOME_PROOF_PATTERNS)) warnings.push('Einkommensnachweis verlangt');
  if (containsAny(description, GUARANTOR_PATTERNS)) warnings.push('Bürgschaft/Guarantor verlangt');
  if (furnishing === 'FURNITURE_TAKEOVER' && abloeseCents != null) {
    const eur = Math.round(abloeseCents / 100);
    warnings.push(`Möbelübernahme/Ablöse: ${eur} € einmalig`);
  }
  if (kaltMieteCents != null && warmMieteCents == null && !monthlyTotalComplete) {
    warnings.push('Nur Kaltmiete bekannt — echte Warmmiete unbekannt');
  }

  return {
    propertyType,
    furnishing,
    fittedKitchen,
    warmMieteCents,
    kaltMieteCents,
    nebenkostenCents,
    heizkostenCents,
    depositCents,
    abloeseCents,
    provisionNote,
    effectiveMonthlyCents,
    monthlyTotalComplete,
    rooms,
    livingSpaceSqm,
    availableNow: availability.availableNow,
    availableFrom: availability.availableFrom,
    wbsRequired,
    exchangeRequired,
    petsAllowed,
    fixedTerm,
    minDurationMonths,
    maxDurationMonths,
    anmeldungPossible,
    warnings,
    evidence,
    extractorVersion: EXTRACTOR_VERSION,
  };
}
