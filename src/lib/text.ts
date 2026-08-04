/**
 * Text helpers for the German-language parser and duplicate detection.
 */

export function normaliseText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/ /g, ' ')
    .toLowerCase();
}

export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Slug used for coarse similarity comparisons of titles/locations. */
export function slugify(input: string): string {
  return stripDiacritics(input.toLowerCase())
    .replace(/[^a-z0-9\s]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

/** Extract a short evidence snippet around the first match of `re`. */
export function evidenceAround(text: string, re: RegExp, radius = 40): string | null {
  const match = re.exec(text);
  if (!match) return null;
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + snippet + (end < text.length ? '…' : '');
}

/** Whether the text contains any of the patterns, honouring word-ish edges. */
export function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((r) => r.test(text));
}
