import { describe, expect, it } from 'vitest';
import { planSearchRun, type PlannerSource } from '@/domain/sources/planner';
import type { CanonicalFilterValues } from '@/domain/sources/recipe';

const values: CanonicalFilterValues = {
  location: { city: 'Bad Rappenau', postalCode: '74906', address: 'Salinenstraße 2' },
  radiusKm: 20,
  commuteMinutes: 35,
  maxWarmmieteCents: 90000,
  minRooms: 1,
  propertyType: 'APARTMENT',
  furnished: 'PREFERRED',
  wbs: 'NOT_AVAILABLE',
  minLivingSpace: null,
  availableFrom: null,
  pets: null,
};

const nationwideMarketplace: PlannerSource = {
  id: 's1',
  key: 'immoscout',
  name: 'ImmoScout24',
  active: true,
  integrationMode: 'SEARCH_LINK',
  searchUrlTemplate: null,
  searchUrlValidated: false,
  temporaryOnly: false,
  housingTypes: ['APARTMENT'],
  coverage: [{ kind: 'NATIONWIDE', value: '' }],
  filterMappings: [
    { canonicalFilter: 'location', quality: 'EXACT', portalLabel: 'Ort', note: null },
    { canonicalFilter: 'maxWarmmiete', quality: 'APPROXIMATE', portalLabel: 'Kaltmiete bis', note: 'Portal filtert Kaltmiete' },
    { canonicalFilter: 'furnished', quality: 'MANUAL', portalLabel: null, note: 'nur im Text' },
    { canonicalFilter: 'wbs', quality: 'UNSUPPORTED', portalLabel: null, note: null },
  ],
};

const manualLocal: PlannerSource = {
  ...nationwideMarketplace,
  id: 's2',
  key: 'manual-local',
  name: 'Lokaler Aushang',
  integrationMode: 'BROWSER_ONLY',
  coverage: [{ kind: 'POSTAL_PREFIX', value: '74906' }],
  filterMappings: [
    { canonicalFilter: 'location', quality: 'MANUAL', portalLabel: null, note: null },
    { canonicalFilter: 'maxWarmmiete', quality: 'MANUAL', portalLabel: null, note: null },
  ],
};

const wrongRegion: PlannerSource = {
  ...nationwideMarketplace,
  id: 's3',
  key: 'muenchen-only',
  name: 'Nur München',
  coverage: [{ kind: 'CITY', value: 'München' }],
};

const temporaryOnly: PlannerSource = {
  ...nationwideMarketplace,
  id: 's4',
  key: 'monteurzimmer',
  name: 'Monteurzimmer',
  temporaryOnly: true,
};

describe('planner', () => {
  it('plans every relevant source, including manual-only ones', () => {
    const rep = planSearchRun(
      [nationwideMarketplace, manualLocal, wrongRegion, temporaryOnly],
      values,
      { city: 'Bad Rappenau', postalCode: '74906', state: null },
      { temporaryMode: false },
    );
    const plannedKeys = rep.planned.map((p) => p.sourceKey).sort();
    expect(plannedKeys).toEqual(['immoscout', 'manual-local']);
    expect(rep.excluded.some((e) => e.sourceKey === 'muenchen-only')).toBe(true);
    expect(rep.excluded.some((e) => e.sourceKey === 'monteurzimmer' && /Notfall/.test(e.reason))).toBe(true);
  });

  it('includes temporary source only when temporaryMode is on', () => {
    const rep = planSearchRun(
      [temporaryOnly],
      values,
      { city: 'Bad Rappenau', postalCode: '74906', state: null },
      { temporaryMode: true },
    );
    expect(rep.planned).toHaveLength(1);
  });

  it('records inclusion reason on planned tasks', () => {
    const rep = planSearchRun(
      [nationwideMarketplace, manualLocal],
      values,
      { city: 'Bad Rappenau', postalCode: '74906', state: null },
      { temporaryMode: false },
    );
    const marketplace = rep.planned.find((p) => p.sourceKey === 'immoscout')!;
    const local = rep.planned.find((p) => p.sourceKey === 'manual-local')!;
    expect(marketplace.inclusionReason).toMatch(/bundesweit/i);
    expect(local.inclusionReason).toMatch(/74906/);
  });

  it('surfaces UNSUPPORTED filters in the recipe rather than dropping them', () => {
    const rep = planSearchRun(
      [nationwideMarketplace],
      values,
      { city: 'Bad Rappenau', postalCode: '74906', state: null },
      { temporaryMode: false },
    );
    const recipe = rep.planned[0].recipeSnapshot;
    const wbsLine = recipe.lines.find((l) => l.filter === 'wbs');
    expect(wbsLine?.quality).toBe('UNSUPPORTED');
    // Even an UNSUPPORTED filter appears in the plan.
    expect(recipe.lines.length).toBeGreaterThan(0);
  });

  it('does not generate a search URL when the template is not validated', () => {
    const rep = planSearchRun(
      [nationwideMarketplace],
      values,
      { city: 'Bad Rappenau', postalCode: '74906', state: null },
      { temporaryMode: false },
    );
    expect(rep.planned[0].generatedUrl).toBeNull();
  });
});
