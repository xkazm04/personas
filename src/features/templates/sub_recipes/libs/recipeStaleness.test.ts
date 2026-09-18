import { describe, it, expect } from 'vitest';
import type { DesignUseCase } from '@/lib/types/frontendTypes';
import type { Recipe } from '../types';
import {
  compareVersions,
  findAdoptedUseCase,
  isRecipeStale,
  computeStaleRecipeIds,
} from './recipeStaleness';
import { recipeToUseCase } from './useAdoption';

const recipe = (id: string, version: string): Recipe =>
  ({ id, version } as Recipe);

const uc = (source_recipe_id?: string, source_recipe_version?: string): DesignUseCase =>
  ({ id: 'x', title: 't', description: 'd', source_recipe_id, source_recipe_version } as DesignUseCase);

describe('compareVersions', () => {
  it('orders numeric segments', () => {
    expect(compareVersions('1.1.0', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });
  it('treats unparseable segments as 0', () => {
    expect(compareVersions('1.x', '1.0')).toBe(0);
  });
});

describe('isRecipeStale', () => {
  it('is false when not adopted', () => {
    expect(isRecipeStale(recipe('a', '2.0.0'), undefined)).toBe(false);
  });
  it('is false when the pinned version is missing (can\'t prove behind)', () => {
    expect(isRecipeStale(recipe('a', '2.0.0'), uc('a'))).toBe(false);
  });
  it('is true only when the catalog version is newer', () => {
    expect(isRecipeStale(recipe('a', '2.0.0'), uc('a', '1.0.0'))).toBe(true);
    expect(isRecipeStale(recipe('a', '1.0.0'), uc('a', '1.0.0'))).toBe(false);
    expect(isRecipeStale(recipe('a', '1.0.0'), uc('a', '2.0.0'))).toBe(false);
  });
});

describe('findAdoptedUseCase / computeStaleRecipeIds', () => {
  it('finds by provenance id', () => {
    const ucs = [uc('a', '1.0.0'), uc('b', '1.0.0')];
    expect(findAdoptedUseCase(ucs, 'b')?.source_recipe_id).toBe('b');
    expect(findAdoptedUseCase(ucs, 'z')).toBeUndefined();
  });
  it('collects only recipes whose catalog version moved ahead', () => {
    const recipes = [recipe('a', '2.0.0'), recipe('b', '1.0.0'), recipe('c', '3.0.0')];
    const ucs = [uc('a', '1.0.0'), uc('b', '1.0.0'), uc('c'), uc('d', '0.1.0')];
    const stale = computeStaleRecipeIds(recipes, ucs);
    expect([...stale]).toEqual(['a']); // b equal, c no pinned version, d not in catalog
  });
});

describe('recipeToUseCase provenance', () => {
  // The staleness feature is only reachable if adoption actually pins a
  // version: isRecipeStale refuses to flag an adoption without one, so an
  // unpinned adoption can never produce an Update chip no matter how far the
  // catalog moves ahead.
  const fullRecipe = (version: string): Recipe =>
    ({
      id: 'r-digest',
      slug: 'digest',
      name: 'Digest',
      summary: 's',
      description: 'd',
      category: 'productivity',
      requiredConnectors: [],
      optionalConnectors: [],
      bindings: [],
      isBuiltin: true,
      version,
      publishedAt: '2026-01-01',
      author: 'Personas Team',
      tags: [],
      template: {
        title: 'Daily digest',
        description: 'Summarise overnight mail',
        capabilitySummary: 'Summarise overnight mail',
        promptTemplate: 'Summarise',
        category: 'productivity',
        notificationChannelTypes: [],
      },
    }) as unknown as Recipe;

  it('pins source_recipe_version equal to the catalog version', () => {
    const adopted = recipeToUseCase(fullRecipe('1.2.0'), {});
    expect(adopted.source_recipe_id).toBe('r-digest');
    expect(adopted.source_recipe_version).toBe('1.2.0');
  });

  it('makes a bumped catalog version detectable as stale', () => {
    const adopted = recipeToUseCase(fullRecipe('1.2.0'), {});
    expect(isRecipeStale(fullRecipe('1.3.0'), adopted)).toBe(true);
    expect(isRecipeStale(fullRecipe('1.2.0'), adopted)).toBe(false);
  });

  it('feeds computeStaleRecipeIds, the browse table Update chip source', () => {
    const adopted = recipeToUseCase(fullRecipe('1.2.0'), {});
    expect(computeStaleRecipeIds([fullRecipe('2.0.0')], [adopted]).has('r-digest')).toBe(true);
  });
});
