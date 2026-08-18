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

const immoscout: PlannerSource = {
  id: 's1',
  key: 'immoscout24',
  name: 'ImmoScout24',
  active: true,
  filterMappings: [
    { canonicalFilter: 'location', quality: 'EXACT', portalLabel: 'Ort', note: null },
    {
      canonicalFilter: 'maxWarmmiete',
      quality: 'APPROXIMATE',
      portalLabel: 'Kaltmiete bis',
      note: 'Portal filtert Kaltmiete',
    },
    { canonicalFilter: 'furnished', quality: 'MANUAL', portalLabel: null, note: 'nur im Text' },
    { canonicalFilter: 'wbs', quality: 'UNSUPPORTED', portalLabel: null, note: null },
  ],
};

const kleinanzeigen: PlannerSource = { ...immoscout, id: 's2', key: 'kleinanzeigen', name: 'Kleinanzeigen' };

const switchedOff: PlannerSource = { ...immoscout, id: 's3', key: 'immowelt', name: 'Immowelt', active: false };

describe('planner', () => {
  it('plans a task for every active source', () => {
    const rep = planSearchRun([immoscout, kleinanzeigen], values);
    expect(rep.planned.map((p) => p.sourceKey).sort()).toEqual(['immoscout24', 'kleinanzeigen']);
    expect(rep.skipped).toEqual([]);
  });

  it('skips a source switched off in the registry, and says so', () => {
    const rep = planSearchRun([immoscout, switchedOff], values);
    expect(rep.planned).toHaveLength(1);
    expect(rep.skipped[0]).toMatchObject({ sourceKey: 'immowelt' });
    expect(rep.skipped[0].reason).toMatch(/deaktiviert/i);
  });

  it('surfaces UNSUPPORTED filters in the recipe rather than dropping them', () => {
    const rep = planSearchRun([immoscout], values);
    const recipe = rep.planned[0].recipeSnapshot;
    expect(recipe.lines.find((l) => l.filter === 'wbs')?.quality).toBe('UNSUPPORTED');
    expect(recipe.lines.length).toBeGreaterThan(0);
  });

  it('freezes the mapping into the task, so an old run keeps reading as it did', () => {
    const rep = planSearchRun([immoscout], values);
    expect(rep.planned[0].mappingSnapshot.maxWarmmiete).toMatchObject({
      quality: 'APPROXIMATE',
      portalLabel: 'Kaltmiete bis',
    });
  });
});
