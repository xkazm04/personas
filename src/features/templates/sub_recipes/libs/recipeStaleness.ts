import type { DesignUseCase } from '@/lib/types/frontendTypes';
import type { Recipe } from '../types';

/**
 * Recipe-adoption staleness — did the catalog move ahead of what a persona
 * adopted? Each adopted `DesignUseCase` pins `source_recipe_version` at
 * adoption time (Foundry arc, 2026-07); the catalog recipe carries its
 * current `version`. When the catalog version is newer, the persona is
 * running an older shape of the capability and can re-adopt to refresh.
 */

/** Numeric semver-ish compare. Returns >0 if `a` is newer than `b`. Missing
 *  or unparseable segments sort as 0, so "1.2" vs "1.2.0" is equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The adopted use case for a recipe on the selected persona, if any. */
export function findAdoptedUseCase(
  useCases: readonly DesignUseCase[],
  recipeId: string,
): DesignUseCase | undefined {
  return useCases.find((uc) => uc.source_recipe_id === recipeId);
}

/** True when the recipe is adopted AND the catalog version is newer than the
 *  version pinned at adoption. A recipe with no pinned version (adopted
 *  before provenance versions existed) is never flagged stale — we can't
 *  prove it's behind, and a false "update" nag is worse than silence. */
export function isRecipeStale(recipe: Recipe, adoptedUseCase: DesignUseCase | undefined): boolean {
  if (!adoptedUseCase) return false;
  const pinned = adoptedUseCase.source_recipe_version;
  if (!pinned) return false;
  return compareVersions(recipe.version, pinned) > 0;
}

/** Build the set of recipe ids whose catalog version is ahead of what the
 *  persona adopted — the browse table's "Update" chip source. */
export function computeStaleRecipeIds(
  recipes: readonly Recipe[],
  useCases: readonly DesignUseCase[],
): Set<string> {
  const versionByRecipe = new Map(recipes.map((r) => [r.id, r.version]));
  const stale = new Set<string>();
  for (const uc of useCases) {
    const id = uc.source_recipe_id;
    const pinned = uc.source_recipe_version;
    if (!id || !pinned) continue;
    const current = versionByRecipe.get(id);
    if (current && compareVersions(current, pinned) > 0) stale.add(id);
  }
  return stale;
}
