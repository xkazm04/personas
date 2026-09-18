import { useState } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { useTranslation } from '@/i18n/useTranslation';
import { RecipeCreateFlow } from './RecipeCreateFlow';
import { RecipeListItem } from './RecipeListItem';
import type { CredentialRecipesState } from './useCredentialRecipes';

interface RecipesPanelProps {
  state: CredentialRecipesState;
  /** Opens the create flow seeded with the request the user just ran. */
  onOpenPlayground?: (recipeId: string) => void;
}

/**
 * The credential's recipe lane: what it already has, and a way to add one.
 *
 * Both halves are components that shipped without a consumer -- see
 * `useCredentialRecipes` for the inventory. This mounts them; it adds no new
 * copy, because a full panel's worth was already translated into all 14
 * locales and rendered by nothing.
 */
export function RecipesPanel({ state, onOpenPlayground }: RecipesPanelProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  return (
    <div className="space-y-3" data-testid="credential-recipes-panel">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-foreground" />
        <div className="flex-1 min-w-0">
          <p className="typo-heading text-foreground">{sh.recipes}</p>
          <p className="typo-body text-foreground">{sh.recipes_subtitle}</p>
        </div>
        {!state.isCreating && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3 h-3" />}
            onClick={() => state.beginCreate()}
            data-testid="credential-recipes-new"
          >
            {sh.new_recipe}
          </Button>
        )}
      </div>

      {state.isCreating && (
        <RecipeCreateFlow
          description={state.description}
          setDescription={state.setDescription}
          generator={state.generator}
          error={state.error}
          saving={state.saving}
          terminalExpanded={terminalExpanded}
          setTerminalExpanded={setTerminalExpanded}
          onGenerate={state.generate}
          onSaveDraft={state.saveDraft}
          onCancel={state.cancelCreate}
        />
      )}

      {/* A fetch never hides rendered rows: the empty state is settled-only. */}
      {!state.isLoading && state.recipes.length === 0 && !state.isCreating && (
        <EmptyIllustration
          icon={BookOpen}
          heading={sh.no_recipes}
          description={sh.no_recipes_hint}
          className="py-4"
        />
      )}

      {state.recipes.length > 0 && (
        <div className="space-y-2">
          {state.recipes.map((recipe) => (
            <RecipeListItem
              key={recipe.id}
              recipe={recipe}
              isExpanded={expandedId === recipe.id}
              onToggleExpand={() => setExpandedId(expandedId === recipe.id ? null : recipe.id)}
              onOpenPlayground={() => onOpenPlayground?.(recipe.id)}
              onDelete={() => void state.remove(recipe.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
