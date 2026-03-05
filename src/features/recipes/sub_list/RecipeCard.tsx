import { BookOpen, Play, Settings, Pencil, Trash2 } from 'lucide-react';
import type { RecipeDefinition } from '@/lib/bindings/RecipeDefinition';

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

function getCategoryStyle(category: string | null): string {
  if (!category) return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25';
  return CATEGORY_COLORS[category.toLowerCase()] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25';
}

function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function RecipeCard({ recipe, onEdit, onPlayground, onDelete, onQuickTest }: RecipeCardProps) {
  const tags = parseTags(recipe.tags);

  return (
    <div className="group relative rounded-xl border border-border/60 bg-card/50 p-4 hover:border-border hover:bg-card/80 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
          <BookOpen className="w-4 h-4 text-primary" />
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
          <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-sm font-medium ${getCategoryStyle(recipe.category)}`}>
            {recipe.category}
          </span>
        )}
        {tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 text-sm text-muted-foreground"
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
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title="Quick test with mock values"
          >
            <Play className="w-3 h-3" /> Run
          </button>
        )}
        <button
          onClick={() => onPlayground(recipe.id)}
          className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="Open settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onEdit(recipe.id)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onDelete(recipe.id)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
