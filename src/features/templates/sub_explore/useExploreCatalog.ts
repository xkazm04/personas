/**
 * Explore — REAL template catalog, loaded at runtime from the bundled JSON glob
 * (getTemplateCatalog — no DB round-trip), mapped into domain-grouped items the
 * Atlas variants render. Replaces the round-1 mock. Recipes (299, seeded
 * separately) are a follow-on; templates are the honest real-data pass.
 */
import { useEffect, useMemo, useState } from 'react';
import { getTemplateCatalog } from '@/lib/personas/templates/templateCatalog';
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';
import { domainForCategories } from './exploreDomains';

export interface ExploreItem {
  id: string;
  name: string;
  blurb: string;
  domainId: string;
  /** Primary raw category — the sub-cluster key inside a domain. */
  category: string;
  /** Service/tool domains this agent touches (real signal from the template). */
  serviceFlow: string[];
  color: string;
  /** 0..1 capability weight (service-flow richness) — drives node sizing. */
  weight: number;
}

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

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) m[it.domainId] = (m[it.domainId] ?? 0) + 1;
    return m;
  }, [items]);

  return { items, byDomain, counts, loading, total: items.length };
}

/** Group a domain's items into sub-clusters keyed by their raw category. */
export function clustersFor(items: ExploreItem[]): { category: string; items: ExploreItem[] }[] {
  const m: Record<string, ExploreItem[]> = {};
  for (const it of items) (m[it.category] ??= []).push(it);
  return Object.entries(m)
    .map(([category, list]) => ({ category, items: list.sort((a, b) => b.weight - a.weight) }))
    .sort((a, b) => b.items.length - a.items.length);
}
