/**
 * Regex library for the German-language listing parser.
 * Patterns operate on lower-cased text (see normaliseText in src/lib/text.ts).
 *
 * Design notes:
 *  - Word boundaries around "möbliert" would ignore "vollmöbliert", so we use
 *    lookaround on the *suffix* to avoid matching "unmöbliert" or "nicht
 *    möbliert" as furnished evidence.
 *  - Every pattern captures at most one number when a number is relevant.
 */

// ---- furnishing ---------------------------------------------------------

// German attributive adjective endings: -es, -e, -er, -en, -em; we also want to
// accept the plain form. "möbliert(es|e|er|en|em)?" catches all of these
// without matching "möblierten" as "möbliert" + garbage.
const A = '(?:es|em|en|er|e)?';

/** Explicit "not furnished" phrases. These win over any furnished match. */
export const UNFURNISHED_PATTERNS: RegExp[] = [
  new RegExp(`\\bunmöbliert${A}\\b`),
  new RegExp(`\\bunmoebliert${A}\\b`),
  new RegExp(`\\bnicht\\s+möbliert${A}\\b`),
  /\bohne\s+möbel\b/,
  /\bkeine\s+möbel\b/,
  /\bmöbliert\s*:\s*nein\b/,
  /\bmoebliert\s*:\s*nein\b/,
];

export const FULLY_FURNISHED_PATTERNS: RegExp[] = [
  new RegExp(`\\bvoll\\s*möbliert${A}\\b`),
  new RegExp(`\\bvollmöbliert${A}\\b`),
  new RegExp(`\\bvollmoebliert${A}\\b`),
  new RegExp(`\\bkomplett\\s*möbliert${A}\\b`),
  new RegExp(`\\bkomplett\\s*eingerichtet${A}\\b`),
  /\bfully\s+furnished\b/,
];

export const PARTIALLY_FURNISHED_PATTERNS: RegExp[] = [
  new RegExp(`\\bteilweise\\s*möbliert${A}\\b`),
  new RegExp(`\\bteilmöbliert${A}\\b`),
  new RegExp(`\\bteilmoebliert${A}\\b`),
  new RegExp(`\\bteil-möbliert${A}\\b`),
  /\bpartly\s+furnished\b/,
  /\bpartially\s+furnished\b/,
];

/** Any furnished mention that is *not* one of the above. */
export const FURNISHED_HINT_PATTERNS: RegExp[] = [
  new RegExp(`\\bmöbliert${A}\\b`),
  new RegExp(`\\bmoebliert${A}\\b`),
  /\bfurnished\b/,
];

/** Furniture takeover / Ablöse — often signals ~unfurnished apartment + fee. */
export const FURNITURE_TAKEOVER_PATTERNS: RegExp[] = [
  /\bmöbelübernahme\b/,
  /\bmoebeluebernahme\b/,
  /\bmöbel\s*übernahme\b/,
  /\babl(ö|oe)se\b/,
  /\bfurniture\s+takeover\b/,
];

/** Kitchen mentions that must NOT be interpreted as furnished. */
export const FITTED_KITCHEN_PATTERNS: RegExp[] = [
  /\beinbauküche\b/,
  /\beinbaukueche\b/,
  /\bebk\b/,
  /\bküche\s+vorhanden\b/,
  /\bkueche\s+vorhanden\b/,
];

// ---- costs --------------------------------------------------------------

/** Value is captured in group 1 as a raw German-formatted amount. */
const AMOUNT = `(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)`;

export const WARMMIETE_PATTERN = new RegExp(`\\bwarmmiete\\b[^\\n]{0,30}?${AMOUNT}\\s*(?:€|eur)`, 'i');
export const WARMMIETE_LABEL_PATTERN = new RegExp(`\\bwarm(?:miete)?\\s*[:=]\\s*${AMOUNT}\\s*(?:€|eur)?`, 'i');

export const KALTMIETE_PATTERN = new RegExp(`\\bkaltmiete\\b[^\\n]{0,30}?${AMOUNT}\\s*(?:€|eur)`, 'i');
export const KALTMIETE_LABEL_PATTERN = new RegExp(`\\bkalt(?:miete)?\\s*[:=]\\s*${AMOUNT}\\s*(?:€|eur)?`, 'i');
export const NETTOKALT_PATTERN = new RegExp(`\\bnettokaltmiete\\b[^\\n]{0,30}?${AMOUNT}\\s*(?:€|eur)`, 'i');

export const NEBENKOSTEN_PATTERN = new RegExp(`\\bnebenkosten\\b[^\\n]{0,30}?${AMOUNT}\\s*(?:€|eur)`, 'i');
export const HEIZKOSTEN_PATTERN = new RegExp(`\\bheizkosten\\b[^\\n]{0,30}?${AMOUNT}\\s*(?:€|eur)`, 'i');

export const KAUTION_PATTERN = new RegExp(`\\bkaution\\b[^\\n]{0,30}?${AMOUNT}\\s*(?:€|eur)`, 'i');
export const ABLOESE_AMOUNT_PATTERN = new RegExp(`\\babl(?:ö|oe)se\\b[^\\n]{0,30}?${AMOUNT}\\s*(?:€|eur)`, 'i');
export const PROVISION_PATTERN = /\bprovision\b|\bcourtage\b|\bmaklergebühr\b/i;
export const PROVISIONSFREI_PATTERN = /\bprovisionsfrei\b|\bohne\s+provision\b|\bcourtage[frei]?\s*:\s*nein\b|\bkeine\s+courtage\b/i;

// ---- rooms & area -------------------------------------------------------

export const ROOMS_PATTERN =
  /\b(\d(?:[.,]\d)?)\s*(?:-|–)?\s*(?:zimmer|zi\.|room[s]?)\b/i;
// `m²` ends in a non-word char (²), so a trailing `\b` never matches.
// Instead we require a following non-alphanumeric or end-of-string.
export const LIVING_SPACE_PATTERN =
  /\b(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|m2|qm|quadratmeter)(?![a-z0-9])/i;

// ---- availability -------------------------------------------------------

export const AVAILABLE_NOW_PATTERNS: RegExp[] = [
  /\bsofort\s+(?:bezieh|verfüg)/,
  /\bsofort\s+frei\b/,
  /\bab\s+sofort\b/,
  /\bavailable\s+now\b/,
];

/** Captures group 1 as ISO-ish date "DD.MM.YYYY" or "MM/YYYY". */
export const AVAILABLE_FROM_PATTERNS: RegExp[] = [
  /(?:frei|bezugsfrei|verfügbar|ab)\s+(?:ab\s+)?(\d{1,2}\.\d{1,2}\.\d{2,4})/i,
  /(?:frei|bezugsfrei|verfügbar|ab)\s+(?:ab\s+)?(\d{1,2}\/\d{4})/i,
  /(?:frei|bezugsfrei|verfügbar|ab)\s+(?:ab\s+)?(\d{4}-\d{2}-\d{2})/i,
];

// ---- restrictions / warnings -------------------------------------------

export const WBS_PATTERNS: RegExp[] = [
  /\bwbs\b/,
  /\bwohnberechtigungsschein\b/,
  /\bwohn-\s*berechtigungsschein\b/,
];

export const EXCHANGE_PATTERNS: RegExp[] = [
  /\btauschwohnung\b/,
  /\bwohnungstausch\b/,
  /\bnur\s+tausch\b/,
  /\bapartment\s+swap\b/,
];

// "befristet", "befristeter", "befristete", "befristeten" — allow adjective endings.
export const FIXED_TERM_PATTERNS: RegExp[] = [
  /\bbefristet(?:es|em|en|er|e)?\b/,
  /\bzeitlich\s+befristet(?:es|em|en|er|e)?\b/,
  /\bfixed[-\s]term\b/,
];

export const MIN_DURATION_PATTERN = /\bmindest(miet|laufzeit)[^\n]{0,20}?(\d+)\s*(?:monat|month)/i;
export const MAX_DURATION_PATTERN = /\b(?:maximal|höchstens|max\.?)[^\n]{0,20}?(\d+)\s*(?:monat|month)/i;

export const ANMELDUNG_YES_PATTERNS: RegExp[] = [
  /\banmeldung\s+möglich\b/,
  /\bregistration\s+possible\b/,
  /\banmeldbar\b/,
];
export const ANMELDUNG_NO_PATTERNS: RegExp[] = [
  /\bkeine\s+anmeldung\b/,
  /\banmeldung\s+nicht\s+möglich\b/,
  /\bno\s+registration\b/,
];
export const WOHNUNGSGEBER_PATTERNS: RegExp[] = [/\bwohnungsgeberbestätigung\b/, /\bwohnungsgeber-bestätigung\b/];

export const PETS_YES_PATTERNS: RegExp[] = [
  /\bhaustiere\s+erlaubt\b/,
  /\bhaustiere\s+willkommen\b/,
  /\bhunde?\s+erlaubt\b/,
  /\bkatzen\s+erlaubt\b/,
  /\bpets\s+allowed\b/,
];
export const PETS_NO_PATTERNS: RegExp[] = [
  /\bkeine\s+haustiere\b/,
  /\bhaustiere\s+nicht\s+erlaubt\b/,
  /\bkeine\s+hunde\b/,
  /\bno\s+pets\b/,
];

export const SCHUFA_PATTERNS: RegExp[] = [/\bschufa\b/, /\bbonität\b/, /\bbonitaet\b/];
export const INCOME_PROOF_PATTERNS: RegExp[] = [
  /\beinkommens?nachweis\b/,
  /\bgehalts?nachweis\b/,
  /\bproof\s+of\s+income\b/,
];
export const GUARANTOR_PATTERNS: RegExp[] = [/\bbürgschaft\b/, /\bbuergschaft\b/, /\bguarantor\b/];

// ---- property type detection -------------------------------------------

export const PROPERTY_APARTMENT_PATTERNS: RegExp[] = [
  /\bwohnung\b/,
  /\bmietwohnung\b/,
  /\bapartment\b/,
  /\bappartment\b/,
  /\betagenwohnung\b/,
  /\berdgeschosswohnung\b/,
  /\bdachgeschosswohnung\b/,
  /\bmaisonette\b/,
  /\bstudio\b/,
];

export const PROPERTY_WG_PATTERNS: RegExp[] = [
  /\bwg-zimmer\b/,
  /\bwohngemeinschaft\b/,
  /\bwg\b/,
  /\bshared\s+(flat|apartment)\b/,
  /\bshared\s+room\b/,
];

export const PROPERTY_HOUSE_PATTERNS: RegExp[] = [
  /\beinfamilienhaus\b/,
  /\bmehrfamilienhaus\b/,
  /\bdoppelhaushälfte\b/,
  /\breihenhaus\b/,
  /\bhaus\s+zu\s+(miete|kaufen)\b/,
];

export const PROPERTY_TEMPORARY_PATTERNS: RegExp[] = [
  /\bmonteurzimmer\b/,
  /\bboarding\s*house\b/,
  /\bapartservice\b/,
  /\bferienwohnung\b/,
  /\bholiday\s+(let|apartment)\b/,
  /\btemporär(?:es)?\s+wohnen\b/,
];

export const PROPERTY_FOR_SALE_PATTERNS: RegExp[] = [
  /\bzu\s+verkaufen\b/,
  /\bkaufpreis\b/,
  /\beigentumswohnung\b/,
  /\bfor\s+sale\b/,
];
