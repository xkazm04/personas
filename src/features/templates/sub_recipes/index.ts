// Recipes catalog barrel - the page entry mounted from `DesignReviewsPage`
// when the templates sidebar's "Recipes" entry is active, plus the catalog's
// types. Hooks and libs are imported by path inside the feature; nothing
// outside it consumes them.

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

export { RecipesPage } from './RecipesPage';
