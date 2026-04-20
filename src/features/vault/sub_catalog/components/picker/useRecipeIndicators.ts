import { useState, useEffect } from 'react';
import { listCredentialRecipes } from '@/api/vault/credentialRecipes';
import type { CredentialRecipe } from '@/lib/bindings/CredentialRecipe';
import { silentCatch } from '@/lib/silentCatch';

export interface RecipeIndicator {
  usageCount: number;
  source: string;
}

/**
 * Batch-fetches all cached credential recipes and returns a lookup map
 * keyed by connector_name for O(1) access in PickerGrid / ConnectorCard.
 */
export function useRecipeIndicators(): Map<string, RecipeIndicator> {
  const [indicators, setIndicators] = useState<Map<string, RecipeIndicator>>(new Map());

  useEffect(() => {
    let cancelled = false;
    listCredentialRecipes()
      .then((recipes: CredentialRecipe[]) => {
        if (cancelled) return;
        const map = new Map<string, RecipeIndicator>();
        for (const r of recipes) {
          map.set(r.connector_name, {
            usageCount: r.usage_count,
            source: r.source,
          });
        }
        setIndicators(map);
      })
      .catch(silentCatch('useRecipeIndicators:listCredentialRecipes'));
    return () => { cancelled = true; };
  }, []);

  return indicators;
}
