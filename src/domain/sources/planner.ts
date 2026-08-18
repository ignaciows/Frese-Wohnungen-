/**
 * Planning a search run: one task per source, each with the recipe a colleague
 * follows on that portal.
 *
 * This used to decide *which* sources were relevant — filtering fifty entries
 * by region, housing type and emergency mode, and explaining every exclusion.
 * With three nationwide portals there is nothing left to decide: all three are
 * always relevant. What remains is the part that was always the useful bit —
 * turning the candidate's profile into "set these filters on this portal, and
 * check these things by hand afterwards".
 */

import type { CanonicalFilterValues, SourceMapping } from './recipe';
import { buildRecipe } from './recipe';

/** A loose view of the ORM entity, so this module stays trivially testable. */
export interface PlannerSource {
  id: string;
  key: string;
  name: string;
  active: boolean;
  filterMappings: Array<{ canonicalFilter: string; quality: string; portalLabel: string | null; note: string | null }>;
}

export interface PlannedTask {
  sourceId: string;
  sourceKey: string;
  sourceName: string;
  /** Frozen at plan time, so history stays readable when the catalogue changes. */
  mappingSnapshot: SourceMapping;
  recipeSnapshot: ReturnType<typeof buildRecipe>;
}

export interface PlannerReport {
  planned: PlannedTask[];
  /** Sources switched off in the registry. Kept so the UI can say why. */
  skipped: Array<{ sourceKey: string; sourceName: string; reason: string }>;
}

function mappingFrom(source: PlannerSource): SourceMapping {
  const out: SourceMapping = {};
  for (const m of source.filterMappings) {
    out[m.canonicalFilter as keyof SourceMapping] = {
      quality: m.quality as SourceMapping[keyof SourceMapping] extends infer T
        ? T extends { quality: infer Q }
          ? Q
          : never
        : never,
      portalLabel: m.portalLabel,
      note: m.note,
    };
  }
  return out;
}

export function planSearchRun(sources: PlannerSource[], values: CanonicalFilterValues): PlannerReport {
  const planned: PlannedTask[] = [];
  const skipped: PlannerReport['skipped'] = [];

  for (const s of sources) {
    if (!s.active) {
      skipped.push({ sourceKey: s.key, sourceName: s.name, reason: 'im Quellenregister deaktiviert' });
      continue;
    }
    const mapping = mappingFrom(s);
    planned.push({
      sourceId: s.id,
      sourceKey: s.key,
      sourceName: s.name,
      mappingSnapshot: mapping,
      recipeSnapshot: buildRecipe(values, mapping),
    });
  }

  return { planned, skipped };
}
