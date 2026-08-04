/**
 * Search-run planner. Given a candidate's search profile, decide:
 *  - which sources are relevant (geography + housing type + temporary mode),
 *  - why each source is included or excluded,
 *  - the per-source mapping snapshot,
 *  - the per-source recipe snapshot,
 *  - the generated URL (only if the template is validated).
 *
 * A source without a connector is *not* excluded — it is planned as a
 * MANUAL_IMPORT / BROWSER_ONLY task with a recipe.
 */

import type { CanonicalFilterValues, SourceMapping } from './recipe';
import { buildRecipe, buildSearchUrl } from './recipe';

// Loose types over the ORM entities to keep this module easy to unit-test.
export interface PlannerSource {
  id: string;
  key: string;
  name: string;
  active: boolean;
  integrationMode: string;
  searchUrlTemplate: string | null;
  searchUrlValidated: boolean;
  temporaryOnly: boolean;
  housingTypes: string[];
  coverage: Array<{ kind: 'NATIONWIDE' | 'STATE' | 'CITY' | 'POSTAL_PREFIX'; value: string }>;
  filterMappings: Array<{ canonicalFilter: string; quality: string; portalLabel: string | null; note: string | null }>;
}

export interface PlannedTask {
  sourceId: string;
  sourceKey: string;
  sourceName: string;
  integrationMode: string;
  inclusionReason: string;
  mappingSnapshot: SourceMapping;
  recipeSnapshot: ReturnType<typeof buildRecipe>;
  generatedUrl: string | null;
}

export interface PlannerReport {
  planned: PlannedTask[];
  excluded: Array<{ sourceKey: string; sourceName: string; reason: string }>;
}

export interface PlannerLocation {
  city: string | null;
  postalCode: string | null;
  state: string | null;
}

function coverageMatches(source: PlannerSource, loc: PlannerLocation): { matches: boolean; reason: string } {
  if (source.coverage.length === 0) {
    // No explicit coverage = treat as nationwide.
    return { matches: true, reason: 'ohne explizite Regionsangabe (bundesweit angenommen)' };
  }
  const cityLower = loc.city?.toLowerCase() ?? null;
  const stateLower = loc.state?.toLowerCase() ?? null;
  const postal = loc.postalCode ?? null;

  for (const c of source.coverage) {
    if (c.kind === 'NATIONWIDE') return { matches: true, reason: 'bundesweiter Anbieter' };
    if (c.kind === 'STATE' && stateLower && c.value.toLowerCase() === stateLower) {
      return { matches: true, reason: `deckt Bundesland ${c.value} ab` };
    }
    if (c.kind === 'CITY' && cityLower && c.value.toLowerCase() === cityLower) {
      return { matches: true, reason: `deckt ${c.value} ab` };
    }
    if (c.kind === 'POSTAL_PREFIX' && postal && postal.startsWith(c.value)) {
      return { matches: true, reason: `PLZ ${postal} passt zu Präfix ${c.value}` };
    }
  }
  return { matches: false, reason: 'keine passende Region im Quellenregister' };
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

export function planSearchRun(
  sources: PlannerSource[],
  values: CanonicalFilterValues,
  loc: PlannerLocation,
  options: { temporaryMode: boolean },
): PlannerReport {
  const planned: PlannedTask[] = [];
  const excluded: Array<{ sourceKey: string; sourceName: string; reason: string }> = [];

  for (const s of sources) {
    if (!s.active) {
      excluded.push({ sourceKey: s.key, sourceName: s.name, reason: 'im Register deaktiviert' });
      continue;
    }
    if (s.temporaryOnly && !options.temporaryMode) {
      excluded.push({ sourceKey: s.key, sourceName: s.name, reason: 'nur im Notfall-Modus' });
      continue;
    }
    if (
      values.propertyType === 'APARTMENT' &&
      s.housingTypes.length > 0 &&
      !s.housingTypes.includes('APARTMENT') &&
      !s.housingTypes.includes('ANY')
    ) {
      excluded.push({ sourceKey: s.key, sourceName: s.name, reason: 'keine passenden Objekttypen' });
      continue;
    }
    const cov = coverageMatches(s, loc);
    if (!cov.matches) {
      excluded.push({ sourceKey: s.key, sourceName: s.name, reason: cov.reason });
      continue;
    }

    const mapping = mappingFrom(s);
    const recipe = buildRecipe(values, mapping);
    const generatedUrl =
      s.searchUrlTemplate && s.searchUrlValidated ? buildSearchUrl(s.searchUrlTemplate, values) : null;

    planned.push({
      sourceId: s.id,
      sourceKey: s.key,
      sourceName: s.name,
      integrationMode: s.integrationMode,
      inclusionReason: cov.reason,
      mappingSnapshot: mapping,
      recipeSnapshot: recipe,
      generatedUrl,
    });
  }

  return { planned, excluded };
}
