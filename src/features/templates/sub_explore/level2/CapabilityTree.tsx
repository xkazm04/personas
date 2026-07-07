/**
 * Explore level-2 Variant A — "Capability Tree".
 *
 * Leads with TEMPLATES (the thing you adopt), each surfacing the recipes
 * (capabilities) derived from it — mirroring the real source_template_id link.
 * Recipes whose source template isn't in this domain fall to a "More
 * capabilities" shelf so nothing is hidden. Efficient: you see the agent AND
 * what it can already do. PROTOTYPE: hardcoded English.
 */
import { useMemo } from 'react';
import { Blocks } from 'lucide-react';
import type { ExploreItem, ExploreRecipe } from '../useExploreCatalog';
import { L2TemplateCard, L2RecipeCard } from './L2Cards';

interface Props {
  templates: ExploreItem[];
  recipes: ExploreRecipe[];
  accent: string;
  onSelect?: (i: ExploreItem) => void;
  onSelectRecipe?: (r: ExploreRecipe) => void;
}

export function CapabilityTree({ templates, recipes, accent, onSelect, onSelectRecipe }: Props) {
  const sorted = useMemo(() => [...templates].sort((a, b) => b.weight - a.weight), [templates]);

  const orphanRecipes = useMemo(() => {
    const ids = new Set(templates.map((t) => t.id));
    return recipes.filter((r) => !r.sourceTemplateId || !ids.has(r.sourceTemplateId));
  }, [templates, recipes]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        {sorted.map((t) => (
          <L2TemplateCard key={t.id} item={t} accent={accent} onSelect={onSelect} onSelectRecipe={onSelectRecipe} />
        ))}
      </div>

      {orphanRecipes.length > 0 && (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 typo-body font-medium text-foreground">
            <Blocks className="w-4 h-4" style={{ color: accent }} />
            More capabilities
            <span className="typo-caption text-foreground opacity-60">{orphanRecipes.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {orphanRecipes
              .sort((a, b) => b.weight - a.weight)
              .map((r) => <L2RecipeCard key={r.id} recipe={r} accent={accent} onSelect={onSelectRecipe} />)}
          </div>
        </div>
      )}
    </div>
  );
}
