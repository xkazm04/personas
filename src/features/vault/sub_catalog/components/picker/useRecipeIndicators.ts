import { useState, useEffect } from 'react';
import { listCredentialRecipes } from '@/api/vault/credentialRecipes';
import type { CredentialRecipe } from '@/lib/bindings/CredentialRecipe';
import { silentCatch } from '@/lib/silentCatch';

export interface RecipeIndicator {
  usageCount: number;
  source: string;
}

// Module-level cache so reopening the credential picker (a frequently
// mounted/unmounted surface) doesn't refetch the full recipe list every time.
// Short TTL keeps it fresh enough; a new recipe shows up on the next expiry.
let cachedIndicators: Map<string, RecipeIndicator> | null = null;
let cachedAt = 0;
const RECIPE_CACHE_TTL_MS = 60_000;

/**
 * Batch-fetches all cached credential recipes and returns a lookup map
 * keyed by connector_name for O(1) access in PickerGrid / ConnectorCard.
 * Result is cached at module scope for RECIPE_CACHE_TTL_MS to avoid a
 * redundant IPC round-trip on every picker mount.
 */
export function useRecipeIndicators(): Map<string, RecipeIndicator> {
  const [indicators, setIndicators] = useState<Map<string, RecipeIndicator>>(
    () => cachedIndicators ?? new Map(),
  );

  useEffect(() => {
    if (cachedIndicators && Date.now() - cachedAt < RECIPE_CACHE_TTL_MS) {
      setIndicators(cachedIndicators);
      return;
    }
    let cancelled = false;
    listCredentialRecipes()
      .then((recipes: CredentialRecipe[]) => {
        const map = new Map<string, RecipeIndicator>();
        for (const r of recipes) {
          map.set(r.connector_name, {
            usageCount: r.usage_count,
            source: r.source,
          });
        }
        cachedIndicators = map;
        cachedAt = Date.now();
        if (!cancelled) setIndicators(map);
      })
      .catch(silentCatch('useRecipeIndicators:listCredentialRecipes'));
    return () => { cancelled = true; };
  }, []);

  return indicators;
}
