/**
 * Explore level 2 — shared cards for templates and recipes.
 * PROTOTYPE (level 2 not locked): hardcoded English.
 */
import { FileStack, Blocks, ArrowRight } from 'lucide-react';
import { categoryLabel } from '../exploreDomains';
import { recipesForTemplate, type ExploreItem, type ExploreRecipe } from '../useExploreCatalog';

/** Template card that also surfaces the capabilities (recipes) derived from it. */
export function L2TemplateCard({ item, accent, onSelect, onSelectRecipe }: {
  item: ExploreItem; accent: string;
  onSelect?: (i: ExploreItem) => void;
  onSelectRecipe?: (r: ExploreRecipe) => void;
}) {
  const recipes = recipesForTemplate(item.id);
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/10 p-4 flex flex-col gap-2" style={{ boxShadow: `inset 3px 0 0 0 ${accent}` }}>
      <button onClick={() => onSelect?.(item)} className="group/card text-left flex items-start justify-between gap-2">
        <span className="typo-heading template-name-themed leading-snug">{item.name}</span>
        <span className="inline-flex items-center gap-1 typo-caption text-foreground opacity-60 flex-shrink-0 mt-0.5">
          <FileStack className="w-3 h-3" /> Template
        </span>
      </button>
      {item.blurb && <p className="typo-caption text-foreground opacity-80 line-clamp-2">{item.blurb}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="typo-caption px-1.5 py-0.5 rounded-input" style={{ color: accent, backgroundColor: `${accent}18` }}>{categoryLabel(item.category)}</span>
        {item.serviceFlow.slice(0, 3).map((s) => <span key={s} className="typo-caption text-foreground opacity-55">{s}</span>)}
      </div>
      {recipes.length > 0 && (
        <div className="mt-1 pt-2 border-t border-primary/10">
          <div className="typo-caption text-foreground opacity-60 mb-1.5 inline-flex items-center gap-1">
            <Blocks className="w-3 h-3" /> {recipes.length} {recipes.length === 1 ? 'capability' : 'capabilities'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recipes.slice(0, 5).map((r) => (
              <button
                key={r.id}
                onClick={() => onSelectRecipe?.(r)}
                className="typo-caption px-2 py-0.5 rounded-input bg-background/50 border border-primary/10 text-foreground hover:border-primary/25 transition-colors"
              >
                {r.name}
              </button>
            ))}
            {recipes.length > 5 && <span className="typo-caption text-foreground opacity-50 self-center">+{recipes.length - 5}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Standalone recipe card. */
export function L2RecipeCard({ recipe, accent, onSelect }: {
  recipe: ExploreRecipe; accent: string; onSelect?: (r: ExploreRecipe) => void;
}) {
  return (
    <button
      onClick={() => onSelect?.(recipe)}
      className="group/card text-left w-full rounded-modal border border-primary/10 bg-secondary/5 hover:bg-secondary/15 hover:border-primary/25 transition-all p-3.5 flex flex-col gap-1.5"
      style={{ boxShadow: `inset 3px 0 0 0 ${accent}66` }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="typo-heading template-name-themed leading-snug">{recipe.name}</span>
        <span className="inline-flex items-center gap-1 typo-caption text-foreground opacity-60 flex-shrink-0 mt-0.5">
          <Blocks className="w-3 h-3" /> Recipe
        </span>
      </div>
      {recipe.blurb && <p className="typo-caption text-foreground opacity-80 line-clamp-2">{recipe.blurb}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="typo-caption px-1.5 py-0.5 rounded-input" style={{ color: accent, backgroundColor: `${accent}14` }}>{categoryLabel(recipe.category)}</span>
        {recipe.toolCount > 0 && <span className="typo-caption text-foreground opacity-55">{recipe.toolCount} tools</span>}
        <ArrowRight className="w-3 h-3 opacity-0 group-hover/card:opacity-40 transition-opacity ml-auto" />
      </div>
    </button>
  );
}
