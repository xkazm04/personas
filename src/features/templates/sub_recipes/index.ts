// Phase 2 barrel — types, seed catalog, eligibility, and the page entry
// component mounted from `DesignReviewsPage` when the templates sidebar's
// "Recipes" entry is active.

export type {
  Recipe,
  RecipeCategory,
  RecipeUseCaseTemplate,
  RecipeBinding,
  BindingKind,
  BindingValue,
  Eligibility,
  AdoptionMetadata,
} from './types';

export { MOCK_RECIPES } from './mockRecipes';
export { resolveEligibility } from './eligibility';
export {
  useAvailableConnectors,
  usePersonaConnectors,
  useNoPersonaSelected,
  useRecipeEligibility,
  useRecipeEligibilityMap,
} from './useEligibility';

export { RecipesPage } from './RecipesPage';
export { useAdoption, recipeToUseCase } from './libs/useAdoption';
