/**
 * ComposerRecipeSuggestion — Stage D Phases 2 / 3 / 4 / 5.
 *
 * Surfaces an existing recipe when the user's typed task closely matches
 * one in the catalog. Calls `match_recipes_to_intent` with a 300ms debounce
 * after the task field stops changing. Renders only when the top match
 * clears the server-side `SUGGESTION_THRESHOLD` (0.90).
 *
 * Phase 2: surface only — chip + dismiss button.
 * Phase 3: parent supplies `onApply` to pre-fill the draft from the matched
 *   recipe (mode 1 acceptance).
 * Phase 4: log impression / accept / dismiss to `recipe_suggestion_events`
 *   so Phase 5 mode-2 (skip build) has the data it needs to gate eligibility.
 *   We log impressions exactly once per surfaced match (keyed on recipe_id),
 *   so a single chip stays at one impression even as the user re-types
 *   variations of the same task.
 * Phase 5: when the server-side `mode_2_eligible` flag is true (≥20 decisive
 *   events, ≥0.5 accept rate over the last 50), an additional "Run now"
 *   button appears alongside "Use this recipe" — calling `onRunDirect`
 *   instead of going through the Glyph build flow. Eligibility is fetched
 *   lazily once per mount when a match first surfaces (see
 *   `useRecipeSuggestionEligibility`), so the chip stays cheap when the
 *   user types but never sees a match.
 */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Zap } from "lucide-react";
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";
import type { RecipeSuggestionEventType } from "@/lib/bindings/RecipeSuggestionEventType";
import { useRecipeSuggestionEligibility } from "./useRecipeSuggestionEligibility";

const DEBOUNCE_MS = 300;
const MIN_TASK_LENGTH = 8; // skip clearly-too-short prompts

function logSuggestionEvent(
  recipeId: string,
  eventType: RecipeSuggestionEventType,
  score: number,
): void {
  invokeWithTimeout("log_recipe_suggestion_event", {
    recipeId,
    eventType,
    score,
  }).catch(silentCatch(`ComposerRecipeSuggestion.log.${eventType}`));
}

interface Props {
  task: string;
  onApply?: (match: RecipeMatch) => void;
  /**
   * Mode-2 (skip-build) handler — invoked when the user clicks "Run now".
   * Only rendered when both this prop is supplied AND the server-side
   * `mode_2_eligible` gate is true. Treated like an accept by the
   * telemetry pipeline (a click-through is still a click-through).
   */
  onRunDirect?: (match: RecipeMatch) => void;
}

export function ComposerRecipeSuggestion({ task, onApply, onRunDirect }: Props) {
  const { t } = useTranslation();
  const [match, setMatch] = useState<RecipeMatch | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Track which recipe ids we've already logged an impression for in this
  // mount, so re-renders / minor task tweaks don't inflate the count.
  const impressionLoggedRef = useRef<Set<string>>(new Set());
  // Mode-2 eligibility — fetched lazily after the chip first surfaces.
  const eligibility = useRecipeSuggestionEligibility(match !== null);
  const showRunDirect = onRunDirect !== undefined && eligibility === "eligible";

  useEffect(() => {
    const trimmed = task.trim();
    if (trimmed.length < MIN_TASK_LENGTH) {
      setMatch(null);
      return;
    }
    const handle = setTimeout(() => {
      let cancelled = false;
      invokeWithTimeout<RecipeMatch[]>("match_recipes_to_intent", {
        intent: trimmed,
        topK: 1,
      })
        .then((results) => {
          if (cancelled) return;
          const top = results[0];
          // Only surface above-threshold matches; ignore noisy below-threshold.
          if (top && top.above_threshold) {
            setMatch(top);
          } else {
            setMatch(null);
          }
        })
        .catch(silentCatch("ComposerRecipeSuggestion.match"));
      return () => {
        cancelled = true;
      };
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [task]);

  // Don't show after explicit dismiss for the same recipe id, until intent shifts.
  const visible = match && match.recipe_id !== dismissed;

  // Log impression once per surfaced recipe id. Runs after render so the
  // chip is actually visible when we record the event.
  useEffect(() => {
    if (!visible || !match) return;
    if (impressionLoggedRef.current.has(match.recipe_id)) return;
    impressionLoggedRef.current.add(match.recipe_id);
    logSuggestionEvent(match.recipe_id, "impression", match.score);
  }, [visible, match]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={match.recipe_id}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="mx-4 mb-3 flex items-center gap-2 rounded-card border border-card-border bg-secondary/40 px-3 py-2 typo-caption text-foreground/85"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
          <span className="truncate">
            <span className="text-foreground">{t.recipes.composer_suggestion.label}: </span>
            <span className="font-medium text-foreground">{match.recipe_name}</span>
          </span>
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {onApply && (
              <button
                type="button"
                onClick={() => {
                  logSuggestionEvent(match.recipe_id, "accept", match.score);
                  onApply(match);
                }}
                className="rounded-input border border-card-border bg-card-bg px-2 py-0.5 typo-caption font-medium hover:bg-secondary/60 transition-colors"
              >
                {t.recipes.composer_suggestion.use_button}
              </button>
            )}
            {showRunDirect && (
              <button
                type="button"
                onClick={() => {
                  logSuggestionEvent(match.recipe_id, "accept", match.score);
                  onRunDirect!(match);
                }}
                className="flex items-center gap-1 rounded-input border border-primary/40 bg-primary/10 px-2 py-0.5 typo-caption font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <Zap className="h-3 w-3" aria-hidden />
                {t.recipes.composer_suggestion.run_now}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                logSuggestionEvent(match.recipe_id, "dismiss", match.score);
                setDismissed(match.recipe_id);
              }}
              aria-label={t.recipes.composer_suggestion.dismiss}
              className="rounded-input p-1 text-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
