/**
 * Explore — REAL catalog data. Templates load at runtime from the bundled JSON
 * glob (getTemplateCatalog, no DB); recipes come from a trimmed build-time index
 * (recipeIndex.generated.json — regenerate from _recipe_seeds.json). Both are
 * mapped onto the 7 domains; recipes also link back to their source template.
 */
import { useEffect, useMemo, useState } from 'react';
import { getTemplateCatalog } from '@/lib/personas/templates/templateCatalog';
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import { domainForCategories } from './exploreDomains';
import recipeIndex from './recipeIndex.generated.json';

export interface ExploreItem {
  id: string;
  name: string;
  blurb: string;
  domainId: string;
  category: string;
  serviceFlow: string[];
  color: string;
  weight: number;
}

export interface ExploreRecipe {
  id: string;
  name: string;
  blurb: string;
  domainId: string;
  category: string;
  sourceTemplateId: string | null;
  tags: string[];
  toolCount: number;
  weight: number;
}

interface RawRecipe {
  id: string; name: string; description: string; category: string;
  sourceTemplateId: string | null; tags: string[]; toolCount: number;
}

// Recipes are static — map once at module load.
export const RECIPES: ExploreRecipe[] = (recipeIndex as unknown as RawRecipe[]).map((r) => ({
  id: r.id,
  name: r.name,
  blurb: r.description,
  domainId: domainForCategories([r.category]),
  category: r.category,
  sourceTemplateId: r.sourceTemplateId,
  tags: r.tags,
  toolCount: r.toolCount,
  weight: Math.max(0.2, Math.min(1, r.toolCount / 5)),
}));

const RECIPES_BY_TEMPLATE: Record<string, ExploreRecipe[]> = (() => {
  const m: Record<string, ExploreRecipe[]> = {};
  for (const r of RECIPES) if (r.sourceTemplateId) (m[r.sourceTemplateId] ??= []).push(r);
  return m;
})();

const RECIPES_BY_DOMAIN: Record<string, ExploreRecipe[]> = (() => {
  const m: Record<string, ExploreRecipe[]> = {};
  for (const r of RECIPES) (m[r.domainId] ??= []).push(r);
  return m;
})();

export const recipesForTemplate = (templateId: string): ExploreRecipe[] =>
  RECIPES_BY_TEMPLATE[templateId] ?? [];
export const recipesForDomain = (domainId: string): ExploreRecipe[] =>
  RECIPES_BY_DOMAIN[domainId] ?? [];

function serviceFlowOf(entry: TemplateCatalogEntry): string[] {
  const p = entry.payload as unknown as Record<string, unknown>;
  const sf = (p?.service_flow ?? (entry as unknown as Record<string, unknown>)?.service_flow) as unknown;
  return Array.isArray(sf) ? sf.map((s) => String(s)) : [];
}

function toItem(entry: TemplateCatalogEntry): ExploreItem {
  const categories = Array.isArray(entry.category) ? entry.category : [];
  const sf = serviceFlowOf(entry);
  return {
    id: entry.id,
    name: entry.name,
    blurb: entry.description || '',
    domainId: domainForCategories(categories),
    category: categories[0] ?? 'operations',
    serviceFlow: sf,
    color: entry.color || '#8b5cf6',
    weight: Math.max(0.2, Math.min(1, sf.length / 6)),
  };
}

export function useExploreCatalog() {
  const [items, setItems] = useState<ExploreItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getTemplateCatalog()
      .then((entries) => {
        if (!alive) return;
        setItems(entries.map(toItem));
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const byDomain = useMemo(() => {
    const m: Record<string, ExploreItem[]> = {};
    for (const it of items) (m[it.domainId] ??= []).push(it);
    return m;
  }, [items]);

  // Tile count = templates + recipes in that domain (the domain's full weight).
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) m[it.domainId] = (m[it.domainId] ?? 0) + 1;
    for (const [dom, list] of Object.entries(RECIPES_BY_DOMAIN)) m[dom] = (m[dom] ?? 0) + list.length;
    return m;
  }, [items]);

  const templateCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) m[it.domainId] = (m[it.domainId] ?? 0) + 1;
    return m;
  }, [items]);

  return { items, byDomain, counts, templateCounts, loading, total: items.length + RECIPES.length };
}
