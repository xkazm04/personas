/** RecipeStarters - the quiet "Or start from" row under the composer. Up to
 *  three recipes that match the intent, each with its score; a click opens
 *  the recipe's detail (RecipeAlternativeModal, mounted by the layout) where
 *  it can be selected as the starting point. When the top match clears the
 *  suggestion threshold the row says so and that recipe carries a dismiss. */
import { motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";
import type { CinemaRecipes } from "../useCinemaRecipes";
import { EASE } from "../cinemaMotion";
import { COPY } from "../copy";
import Button from '@/features/shared/components/buttons/Button';

interface StarterPillProps {
  match: RecipeMatch;
  suggested: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  dismissLabel: string;
}

function StarterPill({ match, suggested, onOpen, onDismiss, dismissLabel }: StarterPillProps) {
  const pct = Math.round(match.score * 100);
  return (
    <span
      className="inline-flex items-center rounded-full border bg-background/70 backdrop-blur-sm"
      style={{ borderColor: suggested ? "color-mix(in srgb, var(--cinema-accent) 60%, transparent)" : "color-mix(in srgb, var(--foreground) 16%, transparent)" }}
    >
      <Button
        type="button"
        onClick={onOpen}
        aria-label={`${match.recipe_name}, ${COPY.recipes.match(pct)}`}
        data-testid={`recipe-starter-${match.recipe_id}`}
        variant="ghost"
        size="sm"
      >
        <span className="max-w-[180px] truncate">{match.recipe_name}</span>
        <span className="font-mono typo-caption tabular-nums" style={suggested ? { color: "var(--cinema-accent)" } : undefined}>{pct}%</span>
      </Button>
      {suggested && (
        <Button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          variant="ghost"
          size="icon-sm"
          className="mr-0.5"
          icon={<X className="w-3.5 h-3.5" aria-hidden />}
        />
      )}
    </span>
  );
}

export function RecipeStarters({ recipes }: { recipes: CinemaRecipes }) {
  const { t } = useTranslation();
  const { shown, suggestion, setOpen, dismiss } = recipes;
  if (shown.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="w-full max-w-[520px] flex items-center justify-center flex-wrap gap-1.5"
      data-testid="sheet-cinema-recipe-starters"
    >
      <span className="inline-flex items-center gap-1.5 typo-body text-ink-1 mr-0.5">
        <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--cinema-accent)" }} aria-hidden />
        {suggestion ? t.recipes.composer_suggestion.label : COPY.recipes.orStartFrom}
      </span>
      {shown.map((m) => (
        <StarterPill
          key={m.recipe_id}
          match={m}
          suggested={m === suggestion}
          onOpen={() => setOpen(m)}
          onDismiss={() => dismiss(m)}
          dismissLabel={t.recipes.composer_suggestion.dismiss}
        />
      ))}
    </motion.div>
  );
}
