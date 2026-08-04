/**
 * Money helpers. Everything is stored in integer cents so JavaScript floats
 * never round rent into the wrong tier ("899.995 € was here!").
 */

const NUMBER_WITH_GERMAN_THOUSANDS = /^\d{1,3}(\.\d{3})+(,\d+)?$/;

/**
 * Parse a German-formatted amount ("1.050,00", "900", "900,00", "1050.50")
 * into integer cents. Returns null when nothing recognisable is found.
 */
export function parseGermanAmountToCents(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }

  const trimmed = input.trim().replace(/€/g, '').replace(/EUR/gi, '').trim();
  if (trimmed === '') return null;

  let normalised: string;
  if (NUMBER_WITH_GERMAN_THOUSANDS.test(trimmed)) {
    // 1.050,00 -> 1050.00
    normalised = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+(,\d+)$/.test(trimmed)) {
    // 900,00 -> 900.00
    normalised = trimmed.replace(',', '.');
  } else if (/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    // 900 or 900.00 - already plain
    normalised = trimmed;
  } else if (/^\d+(,\d{3})+$/.test(trimmed)) {
    // "1,050" with English thousands - treat as integer euros
    normalised = trimmed.replace(/,/g, '');
  } else {
    return null;
  }

  const value = Number.parseFloat(normalised);
  if (!Number.isFinite(value) || value < 0) return null;
  // Guard against absurd values - stops "10000 sqm" from being read as €10 000.
  if (value > 1_000_000) return null;
  return Math.round(value * 100);
}

export function formatEuroCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  const euros = cents / 100;
  return euros.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
}
