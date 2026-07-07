import { describe, it, expect } from 'vitest';
import type { DesignUseCase } from '@/lib/types/frontendTypes';
import type { Recipe } from '../types';
import {
  compareVersions,
  findAdoptedUseCase,
  isRecipeStale,
  computeStaleRecipeIds,
} from './recipeStaleness';

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
