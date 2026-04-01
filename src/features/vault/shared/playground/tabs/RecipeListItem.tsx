import { BookOpen, Settings, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { PromptTemplateRenderer } from '@/features/shared/components/editors/PromptTemplateRenderer';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';

interface RecipeListItemProps {
  recipe: RecipeDefinition;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenPlayground: () => void;
  onDelete: () => void;
}

export function RecipeListItem({
  recipe,
  isExpanded,
  onToggleExpand,
  onOpenPlayground,
  onDelete,
}: RecipeListItemProps) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/30 overflow-hidden hover:border-border/60 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onToggleExpand}
          className="text-muted-foreground/50 hover:text-foreground/80 transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
          <BookOpen className="w-3 h-3 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{recipe.name}</p>
          {recipe.description && (
            <p className="text-sm text-muted-foreground/60 truncate">{recipe.description}</p>
          )}
        </div>
        {recipe.category && (
          <span className="rounded-lg border border-border/40 bg-muted/20 px-2 py-0.5 text-sm text-muted-foreground shrink-0">
            {recipe.category}
          </span>
        )}
        <button
          onClick={onOpenPlayground}
          className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
          title="Open settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg p-1.5 text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {isExpanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0 border-t border-border/30 space-y-2">
              <div>
                <p className="text-sm text-muted-foreground/50 mt-2 mb-0.5">Prompt Template</p>
                <PromptTemplateRenderer content={recipe.prompt_template || '(empty)'} maxHeight="max-h-40" />
              </div>
              <div className="flex gap-4 text-sm text-muted-foreground/50">
                <span>Created: {new Date(recipe.created_at).toLocaleDateString()}</span>
                <span>Updated: {new Date(recipe.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
