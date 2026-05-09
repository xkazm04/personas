import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import type { RecipeDefinition } from "@/lib/bindings/RecipeDefinition";
import type { CreateRecipeInput } from "@/lib/bindings/CreateRecipeInput";
import type { UpdateRecipeInput } from "@/lib/bindings/UpdateRecipeInput";
import { createRecipe, deleteRecipe, getPersonaRecipes, linkRecipeToPersona, listRecipes, unlinkRecipeFromPersona, updateRecipe } from "@/api/recipes/recipes";


export interface RecipeSlice {
  // State
  recipes: RecipeDefinition[];
  /**
   * Stage D Phase 5 — handoff slot for the Glyph composer's "Run now"
   * mode-2 path. The composer sets this id, switches the sidebar to the
   * design-reviews route, and the RecipeManager consumes it on mount to
   * jump straight into the playground for that recipe. Cleared by
   * `consumePendingPlayground` so a stale value from a prior session
   * doesn't auto-open on the next sidebar switch.
   */
  pendingPlaygroundRecipeId: string | null;

  // Actions
  fetchRecipes: () => Promise<void>;
  createRecipe: (input: CreateRecipeInput) => Promise<string>;
  updateRecipe: (id: string, input: UpdateRecipeInput) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  linkRecipeToPersona: (personaId: string, recipeId: string) => Promise<void>;
  unlinkRecipeFromPersona: (personaId: string, recipeId: string) => Promise<void>;
  fetchPersonaRecipes: (personaId: string) => Promise<RecipeDefinition[]>;
  setPendingPlayground: (recipeId: string | null) => void;
  /** Read-and-clear; returns the pending id if any. */
  consumePendingPlayground: () => string | null;
}

export const createRecipeSlice: StateCreator<PipelineStore, [], [], RecipeSlice> = (set, get) => ({
  recipes: [],
  pendingPlaygroundRecipeId: null,

  fetchRecipes: async () => {
    try {
      const recipes = await listRecipes();
      set({ recipes, error: null });
    } catch (err) {
      reportError(err, "Failed to fetch recipes", set);
      throw err;
    }
  },

  createRecipe: async (input) => {
    try {
      const created = await createRecipe(input);
      await get().fetchRecipes();
      set({ error: null });
      return created.id;
    } catch (err) {
      reportError(err, "Failed to create recipe", set);
      throw err;
    }
  },

  updateRecipe: async (id, input) => {
    try {
      await updateRecipe(id, input);
      await get().fetchRecipes();
      set({ error: null });
    } catch (err) {
      reportError(err, "Failed to update recipe", set);
      throw err;
    }
  },

  deleteRecipe: async (id) => {
    try {
      await deleteRecipe(id);
      await get().fetchRecipes();
      set({ error: null });
    } catch (err) {
      reportError(err, "Failed to delete recipe", set);
      throw err;
    }
  },

  linkRecipeToPersona: async (personaId, recipeId) => {
    try {
      await linkRecipeToPersona({ persona_id: personaId, recipe_id: recipeId, sort_order: null, config: null });
      set({ error: null });
    } catch (err) {
      reportError(err, "Failed to link recipe", set);
      throw err;
    }
  },

  unlinkRecipeFromPersona: async (personaId, recipeId) => {
    try {
      await unlinkRecipeFromPersona(personaId, recipeId);
      set({ error: null });
    } catch (err) {
      reportError(err, "Failed to unlink recipe", set);
      throw err;
    }
  },

  fetchPersonaRecipes: async (personaId) => {
    try {
      const recipes = await getPersonaRecipes(personaId);
      return recipes;
    } catch (err) {
      reportError(err, "Failed to fetch persona recipes", set);
      throw err;
    }
  },

  setPendingPlayground: (recipeId) => {
    set({ pendingPlaygroundRecipeId: recipeId });
  },

  consumePendingPlayground: () => {
    const id = get().pendingPlaygroundRecipeId;
    if (id !== null) set({ pendingPlaygroundRecipeId: null });
    return id;
  },
});
