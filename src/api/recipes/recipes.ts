import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { RecipeDefinition } from "@/lib/bindings/RecipeDefinition";
import type { CreateRecipeInput } from "@/lib/bindings/CreateRecipeInput";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";
import type { RecipeSuggestionEventType } from "@/lib/bindings/RecipeSuggestionEventType";

export interface CancelResult {
  was_running: boolean;
  cancelled_id: string | null;
}

// ============================================================================
// Recipe CRUD
// ============================================================================

/** Page size the recipes catalog requests. Backend clamps to 1..=200. */
export const RECIPE_PAGE_SIZE = 50;

export const listRecipes = (opts?: { limit?: number; offset?: number }) =>
  invoke<RecipeDefinition[]>(
    "list_recipes",
    opts?.limit != null ? { limit: opts.limit, offset: opts.offset ?? 0 } : {},
  );

export const getRecipe = (id: string) =>
  invoke<RecipeDefinition>("get_recipe", { id });

export const createRecipe = (input: CreateRecipeInput) =>
  invoke<RecipeDefinition>("create_recipe", { input });

export const deleteRecipe = (id: string) =>
  invoke<boolean>("delete_recipe", { id });

// ============================================================================
// Persona <-> Recipe Links
// ============================================================================

// ============================================================================
// Recipe Execution (Test Runner)
// ============================================================================

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

// ============================================================================
// Use Case <-> Recipe Connection
// ============================================================================

