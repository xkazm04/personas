import { useState, useMemo, useEffect } from 'react';
import { X, BookOpen, Search, Plus } from 'lucide-react';
import { usePipelineStore } from "@/stores/pipelineStore";
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { useTranslation } from '@/i18n/useTranslation';

interface RecipePickerProps {
  /** Recipes already linked -- excluded from the list */
  linkedRecipeIds: Set<string>;
  onSelect: (recipe: RecipeDefinition) => void;
  onClose: () => void;
}

export function RecipePicker({ linkedRecipeIds, onSelect, onClose }: RecipePickerProps) {
  const { t } = useTranslation();
  const recipes = usePipelineStore((s) => s.recipes);
  const [search, setSearch] = useState('');

  const available = useMemo(() => {
    const q = search.toLowerCase();
    return recipes.filter(
      (r) =>
        !linkedRecipeIds.has(r.id) &&
        (r.name.toLowerCase().includes(q) ||
          (r.description ?? '').toLowerCase().includes(q) ||
          (r.category ?? '').toLowerCase().includes(q)),
    );
  }, [recipes, linkedRecipeIds, search]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="animate-fade-slide-in relative flex flex-col w-[500px] max-h-[70vh] rounded-modal border border-border/60 bg-background shadow-elevation-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="typo-heading font-semibold text-foreground flex-1">{t.recipes.link_recipe}</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded-card text-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border/30">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.recipes.search_recipes}
              autoFocus
              className="w-full rounded-modal border border-border/50 bg-background/50 pl-8 pr-3 py-1.5 typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {available.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 typo-body text-foreground">
              {recipes.length === linkedRecipeIds.size
                ? t.recipes.all_linked
                : t.recipes.no_matching}
            </div>
          ) : (
            <div className="space-y-1">
              {available.map((recipe) => (
                <button
                  key={recipe.id}
                  onClick={() => onSelect(recipe)}
                  className="w-full flex items-center gap-3 rounded-modal px-3 py-2.5 text-left hover:bg-primary/10 transition-colors group"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-card bg-primary/10 border border-primary/20">
                    <BookOpen className="w-3 h-3 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="typo-body font-medium text-foreground truncate">{recipe.name}</p>
                    {recipe.description && (
                      <p className="typo-body text-foreground truncate">{recipe.description}</p>
                    )}
                  </div>
                  <Plus className="w-3.5 h-3.5 text-foreground group-hover:text-primary transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
