/**
 * Explore level-2 Variant B — "Unified Shelf".
 *
 * One filterable surface for a domain: a type toggle (All / Templates / Recipes)
 * plus sub-category chips, over a mixed card grid. Optimizes for breadth and
 * quick scanning rather than the template→recipe hierarchy. PROTOTYPE: hardcoded.
 */
import { useMemo, useState } from 'react';
import { categoryLabel } from '../exploreDomains';
import type { ExploreItem, ExploreRecipe } from '../useExploreCatalog';
import { L2TemplateCard, L2RecipeCard } from './L2Cards';

type TypeFilter = 'all' | 'templates' | 'recipes';

interface Props {
  templates: ExploreItem[];
  recipes: ExploreRecipe[];
  accent: string;
  onSelect?: (i: ExploreItem) => void;
  onSelectRecipe?: (r: ExploreRecipe) => void;
}

export function UnifiedShelf({ templates, recipes, accent, onSelect, onSelectRecipe }: Props) {
  const [type, setType] = useState<TypeFilter>('all');
  const [cat, setCat] = useState<string | null>(null);

  const categories = useMemo(() => {
    const s = new Set<string>();
    if (type !== 'recipes') templates.forEach((t) => s.add(t.category));
    if (type !== 'templates') recipes.forEach((r) => s.add(r.category));
    return [...s].sort();
  }, [templates, recipes, type]);

  const shownTemplates = type !== 'recipes' ? templates.filter((t) => !cat || t.category === cat) : [];
  const shownRecipes = type !== 'templates' ? recipes.filter((r) => !cat || r.category === cat) : [];

  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded-input typo-caption transition-colors ${active ? '' : 'text-foreground opacity-70 hover:opacity-100'}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-input border border-primary/10 p-0.5 bg-background/40">
          {(['all', 'templates', 'recipes'] as TypeFilter[]).map((tp) => (
            <button key={tp} onClick={() => setType(tp)} className={chip(type === tp)}
              style={type === tp ? { backgroundColor: `${accent}26`, color: accent } : undefined}>
              {tp === 'all' ? `All ${templates.length + recipes.length}` : tp === 'templates' ? `Templates ${templates.length}` : `Recipes ${recipes.length}`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setCat(null)} className={chip(cat === null)} style={cat === null ? { backgroundColor: `${accent}18`, color: accent } : undefined}>All</button>
          {categories.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={chip(cat === c)} style={cat === c ? { backgroundColor: `${accent}18`, color: accent } : undefined}>
              {categoryLabel(c)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 items-start">
        {shownTemplates.sort((a, b) => b.weight - a.weight).map((t) => (
          <L2TemplateCard key={t.id} item={t} accent={accent} onSelect={onSelect} onSelectRecipe={onSelectRecipe} />
        ))}
        {shownRecipes.sort((a, b) => b.weight - a.weight).map((r) => (
          <L2RecipeCard key={r.id} recipe={r} accent={accent} onSelect={onSelectRecipe} />
        ))}
      </div>
    </div>
  );
}
