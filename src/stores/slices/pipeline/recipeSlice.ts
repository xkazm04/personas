import type { StateCreator } from "zustand";
import type { PersonaStore } from "../../storeTypes";
import { errMsg } from "../../storeTypes";
import type { RecipeDefinition } from "@/lib/bindings/RecipeDefinition";
import type { CreateRecipeInput } from "@/lib/bindings/CreateRecipeInput";
import type { UpdateRecipeInput } from "@/lib/bindings/UpdateRecipeInput";
import * as api from "@/api/tauriApi";

export interface RecipeSlice {
  // State
  recipes: RecipeDefinition[];

  // Actions
  fetchRecipes: () => Promise<void>;
  createRecipe: (input: CreateRecipeInput) => Promise<string>;
  updateRecipe: (id: string, input: UpdateRecipeInput) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  linkRecipeToPersona: (personaId: string, recipeId: string) => Promise<void>;
  unlinkRecipeFromPersona: (personaId: string, recipeId: string) => Promise<void>;
  fetchPersonaRecipes: (personaId: string) => Promise<RecipeDefinition[]>;
}

export const createRecipeSlice: StateCreator<PersonaStore, [], [], RecipeSlice> = (set, get) => ({
  recipes: [],

  fetchRecipes: async () => {
    try {
      const recipes = await api.listRecipes();
      set({ recipes, error: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch recipes") });
      throw err;
    }
  },

  createRecipe: async (input) => {
    try {
      const created = await api.createRecipe(input);
      await get().fetchRecipes();
      set({ error: null });
      return created.id;
    } catch (err) {
      set({ error: errMsg(err, "Failed to create recipe") });
      throw err;
    }
  },

  updateRecipe: async (id, input) => {
    try {
      await api.updateRecipe(id, input);
      await get().fetchRecipes();
      set({ error: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to update recipe") });
      throw err;
    }
  },

  deleteRecipe: async (id) => {
    try {
      await api.deleteRecipe(id);
      await get().fetchRecipes();
      set({ error: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to delete recipe") });
      throw err;
    }
  },

  linkRecipeToPersona: async (personaId, recipeId) => {
    try {
      await api.linkRecipeToPersona({ persona_id: personaId, recipe_id: recipeId, sort_order: null, config: null });
      set({ error: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to link recipe") });
      throw err;
    }
  },

  unlinkRecipeFromPersona: async (personaId, recipeId) => {
    try {
      await api.unlinkRecipeFromPersona(personaId, recipeId);
      set({ error: null });
    } catch (err) {
      set({ error: errMsg(err, "Failed to unlink recipe") });
      throw err;
    }
  },

  fetchPersonaRecipes: async (personaId) => {
    try {
      const recipes = await api.getPersonaRecipes(personaId);
      return recipes;
    } catch (err) {
      set({ error: errMsg(err, "Failed to fetch persona recipes") });
      throw err;
    }
  },
});
