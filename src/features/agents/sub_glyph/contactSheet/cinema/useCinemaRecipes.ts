/** useCinemaRecipes - recipe decision support for the compose act.
 *
 *  While composing, the intent is matched against the recipe catalog
 *  (`useRecipeStarters` -> `match_recipes_to_intent`) and the top three are
 *  offered as quiet starters under the composer. Opening one shows the
 *  existing RecipeAlternativeModal; "select as alternative" seeds the intent
 *  from the recipe and remembers it, so it is not re-suggested against its own
 *  description and so the build can say which recipe it is building on.
 *
 *  Telemetry is the old composer chip's (`log_recipe_suggestion_event`): a
 *  top match that clears the server threshold is the "suggestion" and logs
 *  one impression per recipe id; selecting it logs an accept, dismissing it
 *  logs a dismiss. Lower-scored starters are browsing, not suggestions, and
 *  log nothing, matching what the chip counted. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logRecipeSuggestionEvent } from "@/api/recipes/recipes";
import { silentCatch } from "@/lib/silentCatch";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";
import type { RecipeDefinition } from "@/lib/bindings/RecipeDefinition";
import type { RecipeSuggestionEventType } from "@/lib/bindings/RecipeSuggestionEventType";
import { useRecipeStarters } from "@/features/agents/sub_glyph/useRecipeStarters";

/** Starters shown under the composer. */
const SHOWN = 3;
/** Fetched, so the row stays full after a pick or a dismiss. */
const FETCHED = 6;

function logEvent(recipeId: string, type: RecipeSuggestionEventType, score: number) {
  logRecipeSuggestionEvent(recipeId, type, score).catch(silentCatch(`sheetCinema.recipe.${type}`));
}

export interface PickedRecipe { id: string; name: string }

export function useCinemaRecipes(intentText: string, onIntentChange: (v: string) => void, composing: boolean) {
  // No matching once the build runs: the starters only live on the compose act.
  const starters = useRecipeStarters(composing ? intentText : "", FETCHED);
  const [picked, setPicked] = useState<PickedRecipe | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<RecipeMatch | null>(null);
  const impressed = useRef(new Map<string, number>());

  // A cleared composer is a fresh start: the provenance no longer holds.
  const empty = intentText.trim() === "";
  useEffect(() => { if (empty) setPicked(null); }, [empty]);

  const shown = useMemo(
    () => starters.filter((m) => m.recipe_id !== picked?.id && !dismissed.has(m.recipe_id)).slice(0, SHOWN),
    [starters, picked, dismissed],
  );
  const suggestion = shown[0]?.above_threshold ? shown[0] : null;

  useEffect(() => {
    if (!suggestion || impressed.current.has(suggestion.recipe_id)) return;
    impressed.current.set(suggestion.recipe_id, suggestion.score);
    logEvent(suggestion.recipe_id, "impression", suggestion.score);
  }, [suggestion]);

  const select = useCallback((recipe: RecipeDefinition) => {
    const seed = (recipe.description?.trim() || recipe.name).trim();
    if (seed) onIntentChange(seed);
    setPicked({ id: recipe.id, name: recipe.name });
    const score = impressed.current.get(recipe.id);
    if (score !== undefined) logEvent(recipe.id, "accept", score);
  }, [onIntentChange]);

  const dismiss = useCallback((m: RecipeMatch) => {
    logEvent(m.recipe_id, "dismiss", m.score);
    setDismissed((prev) => new Set(prev).add(m.recipe_id));
  }, []);

  return { shown, suggestion, picked, open, setOpen, select, dismiss };
}

export type CinemaRecipes = ReturnType<typeof useCinemaRecipes>;
