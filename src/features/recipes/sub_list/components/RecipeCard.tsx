import { useState, useEffect, useRef } from 'react';
import { BookOpen, Play, Settings, Pencil, Trash2, Search, Cog, Sparkles, ArrowLeftRight, Eye, type LucideIcon } from 'lucide-react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';
import { parseTags } from '@/features/recipes/shared/recipeParseUtils';
import { useTranslation } from '@/i18n/useTranslation';

interface RecipeCardProps {
  recipe: RecipeDefinition;
  onEdit: (id: string) => void;
  onPlayground: (id: string) => void;
  onDelete: (id: string) => void;
  onQuickTest?: (id: string) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  analysis: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  automation: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  generation: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
  transform: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  monitoring: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
};

const CATEGORY_ICON_COLORS: Record<string, string> = {
  analysis: 'text-blue-400',
  automation: 'text-emerald-400',
  generation: 'text-violet-400',
  transform: 'text-amber-400',
  monitoring: 'text-cyan-400',
};

const CATEGORY_CONTAINER_COLORS: Record<string, string> = {
  analysis: 'bg-blue-500/10 border-blue-500/20',
  automation: 'bg-emerald-500/10 border-emerald-500/20',
  generation: 'bg-violet-500/10 border-violet-500/20',
  transform: 'bg-amber-500/10 border-amber-500/20',
  monitoring: 'bg-cyan-500/10 border-cyan-500/20',
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  analysis: Search,
  automation: Cog,
  generation: Sparkles,
  transform: ArrowLeftRight,
  monitoring: Eye,
};

function getCategoryIcon(category: string | null): LucideIcon {
  if (!category) return BookOpen;
  return CATEGORY_ICONS[category.toLowerCase()] ?? BookOpen;
}

function getCategoryStyle(category: string | null): string {
  if (!category) return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25';
  return CATEGORY_COLORS[category.toLowerCase()] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25';
}

export function RecipeCard({ recipe, onEdit, onPlayground, onDelete, onQuickTest }: RecipeCardProps) {
  const { t } = useTranslation();
  const tags = parseTags(recipe.tags);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (showDeleteConfirm) {
      deleteTimerRef.current = setTimeout(() => setShowDeleteConfirm(false), 5000);
      return () => { if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); };
    }
  }, [showDeleteConfirm]);

  return (
    <div className="group relative rounded-xl border border-border/60 bg-card/50 p-4 hover:border-border hover:bg-card/80 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${CATEGORY_CONTAINER_COLORS[recipe.category?.toLowerCase() ?? ''] ?? 'bg-primary/10 border-primary/20'}`}>
          {(() => { const Icon = getCategoryIcon(recipe.category); return <Icon className={`w-4 h-4 ${CATEGORY_ICON_COLORS[recipe.category?.toLowerCase() ?? ''] ?? 'text-primary'}`} />; })()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground truncate">{recipe.name}</h3>
          {recipe.description && (
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{recipe.description}</p>
          )}
        </div>
      </div>

      {/* Category & Tags */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {recipe.category && (
          <span className={`inline-flex items-center rounded-lg border px-1.5 py-0.5 text-sm font-medium ${getCategoryStyle(recipe.category)}`}>
            {recipe.category}
          </span>
        )}
        {tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center rounded-lg border border-border/50 bg-muted/30 px-1.5 py-0.5 text-sm text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/40">
        {recipe.sample_inputs && onQuickTest && (
          <button
            onClick={() => onQuickTest(recipe.id)}
            className="min-w-8 min-h-8 flex items-center justify-center gap-1 rounded-lg text-sm text-emerald-400 hover:bg-emerald-500/10 transition-colors focus-ring"
            title={t.recipes.run_quick_test}
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onEdit(recipe.id)}
          className="min-w-8 min-h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-ring"
          title={t.recipes.edit_recipe}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onPlayground(recipe.id)}
          className="min-w-8 min-h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-ring"
          title={t.recipes.open_settings}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Separator */}
        <div className="h-4 w-px bg-border/30 mx-0.5" />

        <div className="relative">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="min-w-8 min-h-8 flex items-center justify-center rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 focus-ring"
            title={t.recipes.delete_recipe}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {showDeleteConfirm && (
            <div className="absolute bottom-full right-0 mb-2 z-50 w-56 rounded-xl border border-border/60 bg-card p-3 shadow-elevation-3 transition-all duration-150">
              <p className="text-sm text-foreground mb-1">
                Delete <span className="font-semibold">{recipe.name}</span>?
              </p>
              <p className="text-sm text-muted-foreground/70 mb-3">{t.common.confirm_destructive_cannot_undo}</p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-lg px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); onDelete(recipe.id); }}
                  className="rounded-lg px-2.5 py-1 text-sm font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
