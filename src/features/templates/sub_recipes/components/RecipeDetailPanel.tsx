import { useAgentStore } from '@/stores/agentStore';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { Recipe } from '../types';
import { useRecipeEligibility } from '../useEligibility';
import { RecipeDetailHeader } from './detail/RecipeDetailHeader';
import { RecipeHowItRuns } from './detail/RecipeHowItRuns';
import { RecipeNeedsCard } from './detail/RecipeNeedsCard';
import { RecipeGuardrailsCard } from './detail/RecipeGuardrailsCard';

interface RecipeDetailPanelProps {
  recipe: Recipe;
  onBack: () => void;
  onAdopt: () => void;
  /** Clicking a tag jumps back to browse with the tag as the search query. */
  onTagClick?: (tag: string) => void;
}

/**
 * Full-width recipe detail page. Layout:
 *
 *   ┌── back · brand-icon · name · meta badges · Adopt button ─────────┐
 *   │ (eligibility banner when setup is needed / locked)               │
 *   │ About — description + tags                                       │
 *   │ ┌── What it does ─────────┬── What it needs ─────────────────┐   │
 *   │ │ Trigger / Notifications │ Required + optional connectors   │   │
 *   │ │ / Tools                 │ + bindings preview               │   │
 *   │ └─────────────────────────┴──────────────────────────────────┘   │
 *   │ Guardrails & memory — review / memory / failure-handling prose   │
 *   └───────────────────────────────────────────────────────────────────┘
 */
export function RecipeDetailPanel({ recipe, onBack, onAdopt, onTagClick }: RecipeDetailPanelProps) {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const eligibility = useRecipeEligibility(recipe);
  const canAdopt = !!selectedPersona && eligibility.state !== 'incompatible';

  return (
    <div className="flex flex-col h-full">
      <RecipeDetailHeader
        recipe={recipe}
        eligibility={eligibility}
        canAdopt={canAdopt}
        hasPersona={!!selectedPersona}
        onBack={onBack}
        onAdopt={onAdopt}
      />

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {/* About */}
        <div className="px-4 py-4">
          <h4 className="typo-label uppercase tracking-wider text-foreground mb-2">{t.recipes_catalog.about_heading}</h4>
          <p className="typo-body text-foreground/90 leading-relaxed whitespace-pre-line">{recipe.description}</p>
          {recipe.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {recipe.tags.map((tag) => onTagClick ? (
                <Tooltip key={tag} content={t.recipes_catalog.tag_filter_tooltip}>
                  <button
                    type="button"
                    onClick={() => onTagClick(tag)}
                    className="typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border border-card-border/60 bg-secondary/30 text-foreground hover:border-primary/40 hover:text-primary cursor-pointer transition-colors"
                  >
                    {tag}
                  </button>
                </Tooltip>
              ) : (
                <span
                  key={tag}
                  className="typo-label uppercase tracking-wider px-1.5 py-0.5 rounded border border-card-border/60 bg-secondary/30 text-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Two-column spec body */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
          <RecipeHowItRuns recipe={recipe} />
          <RecipeNeedsCard recipe={recipe} />
        </div>

        <RecipeGuardrailsCard recipe={recipe} />
      </div>
    </div>
  );
}
