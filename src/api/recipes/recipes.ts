import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { RecipeDefinition } from "@/lib/bindings/RecipeDefinition";
import type { CreateRecipeInput } from "@/lib/bindings/CreateRecipeInput";
import type { UpdateRecipeInput } from "@/lib/bindings/UpdateRecipeInput";
import type { PersonaRecipeLink } from "@/lib/bindings/PersonaRecipeLink";
import type { CreatePersonaRecipeLinkInput } from "@/lib/bindings/CreatePersonaRecipeLinkInput";
import type { RecipeExecutionInput } from "@/lib/bindings/RecipeExecutionInput";
import type { RecipeExecutionResult } from "@/lib/bindings/RecipeExecutionResult";
import type { RecipeVersion } from "@/lib/bindings/RecipeVersion";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";
import type { RecipeSuggestionEventType } from "@/lib/bindings/RecipeSuggestionEventType";
import type { RecipeSuggestionStats } from "@/lib/bindings/RecipeSuggestionStats";

export interface CancelResult {
  was_running: boolean;
  cancelled_id: string | null;
}

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
// Persona <-> Recipe Links
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
  invoke<CancelResult>("cancel_recipe_execution");

// ============================================================================
// Credential-Level Recipes
// ============================================================================

export const getCredentialRecipes = (credentialId: string) =>
  invoke<RecipeDefinition[]>("get_credential_recipes", { credentialId });

export const startRecipeGeneration = (credentialId: string, description: string) =>
  invoke<{ generation_id: string }>("start_recipe_generation", { credentialId, description });

export const cancelRecipeGeneration = () =>
  invoke<CancelResult>("cancel_recipe_generation");

// ============================================================================
// Use Case <-> Recipe Connection
// ============================================================================

// ============================================================================
// Recipe Versioning
// ============================================================================

export const getRecipeVersions = (recipeId: string) =>
  invoke<RecipeVersion[]>("get_recipe_versions", { recipeId });

export const startRecipeVersioning = (recipeId: string, changeRequirements: string) =>
  invoke<{ versioning_id: string }>("start_recipe_versioning", { recipeId, changeRequirements });

export const cancelRecipeVersioning = () =>
  invoke<CancelResult>("cancel_recipe_versioning");

export interface AcceptRecipeVersionInput {
  recipeId: string;
  promptTemplate: string;
  inputSchema: string | null;
  sampleInputs: string | null;
  description: string | null;
  changesSummary: string | null;
  /** Recipe updated_at captured when generation started — optimistic-lock token
   *  so an edit during the generation window is rejected, not clobbered. */
  expectedUpdatedAt: string | null;
}

// Options object (not positional args) — six same-typed `string | null` fields
// invite a silent mis-mapping (e.g. transposed description/changesSummary) that
// TypeScript can't catch across a flat positional signature.
export const acceptRecipeVersion = ({
  recipeId,
  promptTemplate,
  inputSchema,
  sampleInputs,
  description,
  changesSummary,
  expectedUpdatedAt,
}: AcceptRecipeVersionInput) =>
  invoke<RecipeDefinition>("accept_recipe_version", {
    recipeId, promptTemplate, inputSchema, sampleInputs, description, changesSummary, expectedUpdatedAt,
  });

export const revertRecipeVersion = (recipeId: string, versionId: string) =>
  invoke<RecipeDefinition>("revert_recipe_version", { recipeId, versionId });

// ============================================================================
// Intent matching + suggestion telemetry
// ============================================================================

/**
 * Rank the recipe catalog against a free-text intent. Returns at most `topK`
 * matches (backend default when omitted), already filtered by the matcher's
 * zero-overlap rule. An empty/whitespace intent resolves to `[]` rather than
 * erroring — callers don't need to pre-guard.
 *
 * Consumers must still check `above_threshold` before surfacing a match; the
 * command returns below-threshold rows so callers can log/inspect them.
 */
export const matchRecipesToIntent = (intent: string, topK?: number) =>
  invoke<RecipeMatch[]>("match_recipes_to_intent", { intent, topK });

/**
 * Record one user action on a suggestion chip. `eventType` is the ts-rs
 * binding for the Rust enum, which is itself locked by a CHECK constraint on
 * `recipe_suggestion_events.event_type` — passing anything else is rejected at
 * deserialization. `score` must be finite and within [0.0, 1.0].
 */
export const logRecipeSuggestionEvent = (
  recipeId: string,
  eventType: RecipeSuggestionEventType,
  score: number,
) => invoke<void>("log_recipe_suggestion_event", { recipeId, eventType, score });

/**
 * Aggregated suggestion stats over the most recent `window` events (backend
 * default 50 when null/omitted; non-positive values are ignored). Read
 * `mode_2_eligible` rather than re-deriving the threshold on the frontend.
 */
export const getRecipeSuggestionStats = (window: number | null = null) =>
  invoke<RecipeSuggestionStats>("get_recipe_suggestion_stats", { window });

// ============================================================================
// Use Case <-> Recipe Connection
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
