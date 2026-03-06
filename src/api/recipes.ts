import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { RecipeDefinition } from "@/lib/bindings/RecipeDefinition";
import type { CreateRecipeInput } from "@/lib/bindings/CreateRecipeInput";
import type { UpdateRecipeInput } from "@/lib/bindings/UpdateRecipeInput";
import type { PersonaRecipeLink } from "@/lib/bindings/PersonaRecipeLink";
import type { CreatePersonaRecipeLinkInput } from "@/lib/bindings/CreatePersonaRecipeLinkInput";
import type { RecipeExecutionInput } from "@/lib/bindings/RecipeExecutionInput";
import type { RecipeExecutionResult } from "@/lib/bindings/RecipeExecutionResult";
import type { RecipeVersion } from "@/lib/bindings/RecipeVersion";

// ============================================================================
// Recipe CRUD
// ============================================================================

export const listRecipes = () =>
  invoke<RecipeDefinition[]>("list_recipes");

export const getRecipe = (id: string) =>
  invoke<RecipeDefinition>("get_recipe", { id });

export const createRecipe = (input: CreateRecipeInput) =>
  invoke<RecipeDefinition>("create_recipe", { input });

export const updateRecipe = (id: string, input: UpdateRecipeInput) =>
  invoke<RecipeDefinition>("update_recipe", { id, input });

export const deleteRecipe = (id: string) =>
  invoke<boolean>("delete_recipe", { id });

// ============================================================================
// Persona ↔ Recipe Links
// ============================================================================

export const linkRecipeToPersona = (input: CreatePersonaRecipeLinkInput) =>
  invoke<PersonaRecipeLink>("link_recipe_to_persona", { input });

export const unlinkRecipeFromPersona = (personaId: string, recipeId: string) =>
  invoke<boolean>("unlink_recipe_from_persona", { personaId, recipeId });

export const getPersonaRecipes = (personaId: string) =>
  invoke<RecipeDefinition[]>("get_persona_recipes", { personaId });

// ============================================================================
// Recipe Execution (Test Runner)
// ============================================================================

export const executeRecipe = (input: RecipeExecutionInput) =>
  invoke<RecipeExecutionResult>("execute_recipe", { input });

export const startRecipeExecution = (recipeId: string, inputData: Record<string, unknown>) =>
  invoke<{ execution_id: string }>("start_recipe_execution", { recipeId, inputData });

export const cancelRecipeExecution = () =>
  invoke<boolean>("cancel_recipe_execution");

// ============================================================================
// Credential-Level Recipes
// ============================================================================

export const getCredentialRecipes = (credentialId: string) =>
  invoke<RecipeDefinition[]>("get_credential_recipes", { credentialId });

export const startRecipeGeneration = (credentialId: string, description: string) =>
  invoke<{ generation_id: string }>("start_recipe_generation", { credentialId, description });

export const cancelRecipeGeneration = () =>
  invoke<boolean>("cancel_recipe_generation");

// ============================================================================
// Use Case ↔ Recipe Connection
// ============================================================================

export const getUseCaseRecipes = (useCaseId: string) =>
  invoke<RecipeDefinition[]>("get_use_case_recipes", { useCaseId });

// ============================================================================
// Recipe Versioning
// ============================================================================

export const getRecipeVersions = (recipeId: string) =>
  invoke<RecipeVersion[]>("get_recipe_versions", { recipeId });

export const startRecipeVersioning = (recipeId: string, changeRequirements: string) =>
  invoke<{ versioning_id: string }>("start_recipe_versioning", { recipeId, changeRequirements });

export const cancelRecipeVersioning = () =>
  invoke<boolean>("cancel_recipe_versioning");

export const acceptRecipeVersion = (
  recipeId: string,
  promptTemplate: string,
  inputSchema: string | null,
  sampleInputs: string | null,
  description: string | null,
  changesSummary: string | null,
) =>
  invoke<RecipeDefinition>("accept_recipe_version", {
    recipeId, promptTemplate, inputSchema, sampleInputs, description, changesSummary,
  });

export const revertRecipeVersion = (recipeId: string, versionId: string) =>
  invoke<RecipeDefinition>("revert_recipe_version", { recipeId, versionId });

// ============================================================================
// Use Case ↔ Recipe Connection
// ============================================================================

export const promoteUseCaseToRecipe = (
  credentialId: string | null,
  useCaseId: string,
  name: string,
  description: string | null,
  category: string | null,
) =>
  invoke<RecipeDefinition>("promote_use_case_to_recipe", {
    credentialId,
    useCaseId,
    name,
    description,
    category,
  });
