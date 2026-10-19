import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { RecipeDefinition } from "@/lib/bindings/RecipeDefinition";
import { listRecipes } from "@/api/recipes/recipes";

export interface FetchRecipesOpts {
  /** When set, fetch one page instead of the whole table. */
  limit?: number;
  offset?: number;
  /** Append the page onto `recipes` instead of replacing. */
  append?: boolean;
}

export interface RecipeSlice {
  // State
  recipes: RecipeDefinition[];
  /** True when the last paged fetch returned a full page (more rows may exist). */
  recipesHasMore: boolean;

  // Actions
  fetchRecipes: (opts?: FetchRecipesOpts) => Promise<void>;
}

export const createRecipeSlice: StateCreator<PipelineStore, [], [], RecipeSlice> = (set, get) => ({
  recipes: [],
  recipesHasMore: false,

  fetchRecipes: async (opts) => {
    try {
      if (opts?.limit == null) {
        const recipes = await listRecipes();
        set({ recipes, recipesHasMore: false, error: null });
        return;
      }
      const limit = Math.min(Math.max(opts.limit, 1), 200);
      const offset = opts.offset ?? 0;
      // Ask for one extra row so `recipesHasMore` does not need a COUNT.
      const page = await listRecipes({ limit: limit + 1, offset });
      const hasMore = page.length > limit;
      const items = hasMore ? page.slice(0, limit) : page;
      if (opts.append) {
        const existing = get().recipes;
        const seen = new Set(existing.map((r) => r.id));
        set({
          recipes: [...existing, ...items.filter((r) => !seen.has(r.id))],
          recipesHasMore: hasMore,
          error: null,
        });
      } else {
        set({ recipes: items, recipesHasMore: hasMore, error: null });
      }
    } catch (err) {
      reportError(err, "Failed to fetch recipes", set);
      throw err;
    }
  },
});
