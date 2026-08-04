/**
 * Conservative deterministic duplicate detection.
 *
 * We combine several coarse signals; a "suspected duplicate" needs a strong
 * signal (exact canonical URL, same source-side listing id) OR at least three
 * matching coarse signals. Fuzzy matches never destroy records — they create a
 * suggestion the user can dismiss.
 */

import { slugify } from '@/lib/text';

export interface DuplicateCandidate {
  id: string;
  canonicalUrl: string;
  sourceListingId: string | null;
  title: string;
  locationRaw: string;
  effectiveMonthlyCents: number | null;
  rooms: number | null;
  livingSpaceSqm: number | null;
}

export interface DuplicateMatch {
  otherId: string;
  confidence: number;
  reasons: string[];
}

export function findDuplicates(target: DuplicateCandidate, others: DuplicateCandidate[]): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const targetTitleSlug = slugify(target.title);
  const targetLocationSlug = slugify(target.locationRaw);

  for (const other of others) {
    if (other.id === target.id) continue;
    const reasons: string[] = [];
    let confidence = 0;

    if (other.canonicalUrl && other.canonicalUrl === target.canonicalUrl) {
      reasons.push('Identische kanonische URL');
      confidence = 1;
    }
    if (
      other.sourceListingId &&
      target.sourceListingId &&
      other.sourceListingId === target.sourceListingId
    ) {
      reasons.push('Gleiche Portal-Anzeigen-ID');
      confidence = Math.max(confidence, 0.95);
    }

    if (confidence < 0.9) {
      // Fuzzy signals only kick in if we do not already have a hard match.
      let signals = 0;
      const otherTitleSlug = slugify(other.title);
      const otherLocationSlug = slugify(other.locationRaw);

      if (targetTitleSlug && otherTitleSlug && titleSimilar(targetTitleSlug, otherTitleSlug)) {
        reasons.push('Ähnlicher Titel');
        signals++;
      }
      if (targetLocationSlug && otherLocationSlug && targetLocationSlug === otherLocationSlug) {
        reasons.push('Gleicher Ort');
        signals++;
      }
      if (
        target.effectiveMonthlyCents != null &&
        other.effectiveMonthlyCents != null &&
        Math.abs(target.effectiveMonthlyCents - other.effectiveMonthlyCents) <= 2000 // ≤ 20 €
      ) {
        reasons.push('Sehr ähnlicher Preis');
        signals++;
      }
      if (
        target.rooms != null &&
        other.rooms != null &&
        Math.abs(target.rooms - other.rooms) < 0.1
      ) {
        reasons.push('Gleiche Zimmeranzahl');
        signals++;
      }
      if (
        target.livingSpaceSqm != null &&
        other.livingSpaceSqm != null &&
        Math.abs(target.livingSpaceSqm - other.livingSpaceSqm) <= 2
      ) {
        reasons.push('Sehr ähnliche Fläche');
        signals++;
      }

      if (signals >= 3) confidence = 0.6 + (signals - 3) * 0.1;
    }

    if (confidence >= 0.6) matches.push({ otherId: other.id, confidence, reasons });
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return matches;
}

function titleSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const aTokens = new Set(a.split('-').filter((x) => x.length > 2));
  const bTokens = new Set(b.split('-').filter((x) => x.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return false;
  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter++;
  const jaccard = inter / (aTokens.size + bTokens.size - inter);
  return jaccard >= 0.6;
}
