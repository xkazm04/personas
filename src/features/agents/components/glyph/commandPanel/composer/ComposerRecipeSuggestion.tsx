/**
 * ComposerRecipeSuggestion — Stage D Phase 2.
 *
 * Surfaces an existing recipe when the user's typed task closely matches
 * one in the catalog. Calls `match_recipes_to_intent` with a 300ms debounce
 * after the task field stops changing. Renders only when the top match
 * clears the server-side `SUGGESTION_THRESHOLD` (0.90).
 *
 * Phase 2 scope: surface only — the "Use this recipe" button calls
 * `onApply` if provided, but parents won't wire it until Phase 3 (mode 1
 * pre-fill). When `onApply` is undefined the button is hidden, so this
 * component is safe to mount in Phase 2 with no behavior change for
 * users who haven't opted in.
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";

const DEBOUNCE_MS = 300;
const MIN_TASK_LENGTH = 8; // skip clearly-too-short prompts

interface Props {
  task: string;
  onApply?: (match: RecipeMatch) => void;
}

export function ComposerRecipeSuggestion({ task, onApply }: Props) {
  const { t } = useTranslation();
  const [match, setMatch] = useState<RecipeMatch | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

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
            <span className="text-foreground/60">{t.recipes.composer_suggestion.label}: </span>
            <span className="font-medium text-foreground">{match.recipe_name}</span>
          </span>
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {onApply && (
              <button
                type="button"
                onClick={() => onApply(match)}
                className="rounded-input border border-card-border bg-card-bg px-2 py-0.5 typo-caption font-medium hover:bg-secondary/60 transition-colors"
              >
                {t.recipes.composer_suggestion.use_button}
              </button>
            )}
            <button
              type="button"
              onClick={() => setDismissed(match.recipe_id)}
              aria-label={t.recipes.composer_suggestion.dismiss}
              className="rounded-input p-1 text-foreground/50 hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
