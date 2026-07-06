import { useEffect, useMemo, useState } from 'react';
import { Check, Search, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { CONNECTOR_META, ConnectorIcon } from '@/lib/connectors/connectorMeta';
import { recipeDefinitionsToRecipes } from '@/features/templates/sub_recipes/libs/recipeAdapter';
import { getCategoryLabels } from '@/features/templates/sub_recipes/libs/categoryLabels';
import type { Recipe, RecipeCategory } from '@/features/templates/sub_recipes/types';

interface CapabilityRackProps {
  /** Archetype's natural buckets — the default pre-filter. */
  affinity: string[];
  accentColor: string;
  selected: Map<string, Recipe>;
  onToggle: (r: Recipe) => void;
}

/**
 * Foundry capability rack — browse the recipe catalog and attach
 * capabilities to the composition. Selection only: the actual adoption
 * happens at create time via `recipe_ref`s in the synthesized template
 * payload, hydrated by the real pipeline (so there is no persona yet and
 * no per-recipe adopt call). Defaults to the archetype's affinity buckets;
 * one click widens to the whole catalog.
 */
export function CapabilityRack({ affinity, accentColor, selected, onToggle }: CapabilityRackProps) {
  const { t, tx } = useTranslation();
  const { definitions, fetchRecipes } = usePipelineStore(
    useShallow((s) => ({ definitions: s.recipes, fetchRecipes: s.fetchRecipes })),
  );
  useEffect(() => {
    fetchRecipes().catch(silentCatch('CapabilityRack.fetchRecipes'));
  }, [fetchRecipes]);
  const recipes = useMemo(() => recipeDefinitionsToRecipes(definitions), [definitions]);

  const [search, setSearch] = useState('');
  const [affinityOnly, setAffinityOnly] = useState(true);
  const [category, setCategory] = useState<RecipeCategory | 'all'>('all');
  const labels = getCategoryLabels(t);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((r) => {
      if (affinityOnly && affinity.length > 0 && !affinity.includes(r.category)) return false;
      if (category !== 'all' && r.category !== category) return false;
      if (q) {
        const hay = [r.name, r.summary, ...r.tags].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [recipes, search, affinityOnly, affinity, category]);

  const visibleCategories = useMemo(() => {
    const pool = affinityOnly && affinity.length > 0
      ? recipes.filter((r) => affinity.includes(r.category))
      : recipes;
    const counts = new Map<RecipeCategory, number>();
    for (const r of pool) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [recipes, affinityOnly, affinity]);

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground pointer-events-none" />
          <input
            type="search"
            data-testid="foundry-rack-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.foundry.rack_search_placeholder}
            className="pl-8 pr-3 py-1.5 rounded-input border border-card-border bg-secondary/40 typo-caption text-foreground placeholder:text-foreground/45 focus:outline-none focus:border-primary/45 transition-colors min-w-[200px]"
          />
        </div>
        <button
          type="button"
          data-testid="foundry-rack-affinity-toggle"
          aria-pressed={affinityOnly}
          onClick={() => { setAffinityOnly((v) => !v); setCategory('all'); }}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border typo-caption transition-colors cursor-pointer ${
            affinityOnly
              ? 'border-primary/40 bg-primary/12 text-primary'
              : 'border-card-border bg-secondary/40 text-foreground hover:border-foreground/30'
          }`}
        >
          <Sparkles className="w-3 h-3" />
          {t.foundry.rack_affinity_filter}
        </button>
        {visibleCategories.map(([c, n]) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(category === c ? 'all' : c)}
            className={`px-2 py-1 rounded-full border typo-caption transition-colors cursor-pointer ${
              category === c
                ? 'border-primary/40 bg-primary/12 text-primary'
                : 'border-card-border/60 bg-secondary/30 text-foreground hover:border-foreground/30'
            }`}
          >
            {labels[c]} <span className="font-mono opacity-70">{n}</span>
          </button>
        ))}
        <span className="ml-auto typo-caption text-foreground tabular-nums">
          {tx(t.foundry.rack_selected_count, { count: selected.size })}
        </span>
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin rounded-card border border-card-border/60">
        {filtered.length === 0 ? (
          <div className="py-12 text-center typo-caption text-foreground">{t.foundry.rack_empty}</div>
        ) : (
          filtered.map((r) => (
            <RackRow
              key={r.id}
              recipe={r}
              accentColor={accentColor}
              checked={selected.has(r.id)}
              onToggle={() => onToggle(r)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RackRow({ recipe, accentColor, checked, onToggle }: {
  recipe: Recipe; accentColor: string; checked: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`foundry-rack-recipe-${recipe.slug}`}
      aria-pressed={checked}
      onClick={onToggle}
      className={`flex items-center gap-3 w-full px-3 py-2 border-b border-card-border/40 text-left transition-colors cursor-pointer ${
        checked ? 'bg-primary/[0.06]' : 'hover:bg-secondary/40'
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-4.5 h-4.5 rounded border shrink-0 transition-colors ${
          checked ? 'border-transparent text-primary-foreground' : 'border-foreground/30'
        }`}
        style={checked ? { background: accentColor } : undefined}
      >
        {checked && <Check className="w-3 h-3" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="typo-body text-foreground truncate">{recipe.name}</div>
        <div className="typo-caption text-foreground truncate">{recipe.summary}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {recipe.requiredConnectors.slice(0, 3).map((slug) => {
          const meta = CONNECTOR_META[slug];
          return meta ? <ConnectorIcon key={slug} meta={meta} size="w-3.5 h-3.5" /> : null;
        })}
        {recipe.requiredConnectors.length > 3 && (
          <span className="typo-label text-foreground font-mono">+{recipe.requiredConnectors.length - 3}</span>
        )}
      </div>
    </button>
  );
}
