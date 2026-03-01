import { useState, useMemo, useCallback } from 'react';
import type { DbPersona } from '@/lib/types/types';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { extractConnectorNames } from '@/lib/personas/utils';

// ── Smart Tag Types ──────────────────────────────────────────────────

export interface SmartTag {
  id: string;
  label: string;
  color: string;
  /** Whether this tag was auto-generated (vs user-defined) */
  auto: boolean;
}

/** Generate smart tags for a persona based on its configuration */
function generateSmartTags(
  persona: DbPersona,
  health: PersonaHealth | undefined,
  lastRun: string | null | undefined,
): SmartTag[] {
  const tags: SmartTag[] = [];

  // Connector-based tags
  const connectors = extractConnectorNames(persona, 10);
  for (const name of connectors) {
    const lower = name.toLowerCase();
    if (lower.includes('slack')) tags.push({ id: `auto:slack`, label: 'slack', color: '#4A154B', auto: true });
    else if (lower.includes('github')) tags.push({ id: `auto:github`, label: 'github', color: '#238636', auto: true });
    else if (lower.includes('jira')) tags.push({ id: `auto:jira`, label: 'jira', color: '#0052CC', auto: true });
    else if (lower.includes('linear')) tags.push({ id: `auto:linear`, label: 'linear', color: '#5E6AD2', auto: true });
    else if (lower.includes('notion')) tags.push({ id: `auto:notion`, label: 'notion', color: '#000000', auto: true });
    else if (lower.includes('discord')) tags.push({ id: `auto:discord`, label: 'discord', color: '#5865F2', auto: true });
    else if (lower.includes('supabase')) tags.push({ id: `auto:supabase`, label: 'supabase', color: '#3FCF8E', auto: true });
    else if (lower.includes('postgres') || lower.includes('sql')) tags.push({ id: `auto:database`, label: 'database', color: '#336791', auto: true });
    else tags.push({ id: `auto:${lower}`, label: lower, color: '#6B7280', auto: true });
  }

  // "needs-attention" tag
  const needsAttention =
    (health && (health.status === 'failing' || health.status === 'degraded')) ||
    isStale(lastRun, 7);
  if (needsAttention) {
    tags.push({ id: 'auto:needs-attention', label: 'needs attention', color: '#EF4444', auto: true });
  }

  // Deduplicate by id
  const seen = new Set<string>();
  return tags.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

function isStale(lastRun: string | null | undefined, days: number): boolean {
  if (!lastRun) return true; // never run = stale
  const last = new Date(lastRun).getTime();
  if (isNaN(last)) return true;
  return Date.now() - last > days * 86_400_000;
}

// ── Filter Types ─────────────────────────────────────────────────────

export type StatusFilter = 'all' | 'enabled' | 'disabled';
export type ModelFilter = 'all' | 'anthropic' | 'ollama' | 'litellm' | 'custom' | 'default';
export type HealthFilter = 'all' | 'healthy' | 'degraded' | 'failing' | 'dormant' | 'needs-attention';
export type RecencyFilter = 'all' | 'today' | 'week' | 'month' | 'stale';

export interface FilterState {
  search: string;
  status: StatusFilter;
  model: ModelFilter;
  health: HealthFilter;
  recency: RecencyFilter;
  /** Active smart tag filter (by tag id) */
  tag: string | null;
}

const defaultFilters: FilterState = {
  search: '',
  status: 'all',
  model: 'all',
  health: 'all',
  recency: 'all',
  tag: null,
};

// ── Parse model profile ──────────────────────────────────────────────

function parseModelProfile(persona: DbPersona): ModelProfile | null {
  if (!persona.model_profile) return null;
  try {
    return JSON.parse(persona.model_profile) as ModelProfile;
  } catch {
    return null;
  }
}

function getProviderLabel(persona: DbPersona): string {
  const mp = parseModelProfile(persona);
  if (!mp?.provider) return 'default';
  return mp.provider;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function usePersonaFilters(
  personas: DbPersona[],
  healthMap: Record<string, PersonaHealth>,
  lastRunMap: Record<string, string | null>,
) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);

  const setSearch = useCallback((search: string) => setFilters(f => ({ ...f, search })), []);
  const setStatus = useCallback((status: StatusFilter) => setFilters(f => ({ ...f, status: f.status === status ? 'all' : status })), []);
  const setModel = useCallback((model: ModelFilter) => setFilters(f => ({ ...f, model: f.model === model ? 'all' : model })), []);
  const setHealth = useCallback((health: HealthFilter) => setFilters(f => ({ ...f, health: f.health === health ? 'all' : health })), []);
  const setRecency = useCallback((recency: RecencyFilter) => setFilters(f => ({ ...f, recency: f.recency === recency ? 'all' : recency })), []);
  const setTag = useCallback((tag: string | null) => setFilters(f => ({ ...f, tag: f.tag === tag ? null : tag })), []);
  const clearFilters = useCallback(() => setFilters(defaultFilters), []);

  const hasActiveFilters = filters.search !== '' ||
    filters.status !== 'all' ||
    filters.model !== 'all' ||
    filters.health !== 'all' ||
    filters.recency !== 'all' ||
    filters.tag !== null;

  // Build smart tags map (persona id → tags)
  const smartTagsMap = useMemo(() => {
    const map: Record<string, SmartTag[]> = {};
    for (const p of personas) {
      map[p.id] = generateSmartTags(p, healthMap[p.id], lastRunMap[p.id]);
    }
    return map;
  }, [personas, healthMap, lastRunMap]);

  // Collect all unique tags across all personas for the filter chip palette
  const allTags = useMemo(() => {
    const tagMap = new Map<string, SmartTag>();
    for (const tags of Object.values(smartTagsMap)) {
      for (const t of tags) {
        if (!tagMap.has(t.id)) tagMap.set(t.id, t);
      }
    }
    return Array.from(tagMap.values());
  }, [smartTagsMap]);

  // Filter personas
  const filteredIds = useMemo(() => {
    const query = filters.search.toLowerCase().trim();
    const now = Date.now();

    const ids = new Set<string>();
    for (const p of personas) {
      // Search filter: name, description, system_prompt
      if (query) {
        const haystack = [
          p.name,
          p.description ?? '',
          p.system_prompt ?? '',
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) continue;
      }

      // Status filter
      if (filters.status === 'enabled' && !p.enabled) continue;
      if (filters.status === 'disabled' && p.enabled) continue;

      // Model filter
      if (filters.model !== 'all') {
        const provider = getProviderLabel(p);
        if (provider !== filters.model) continue;
      }

      // Health filter
      if (filters.health !== 'all') {
        const h = healthMap[p.id];
        if (filters.health === 'needs-attention') {
          const bad = h && (h.status === 'failing' || h.status === 'degraded');
          const stale = isStale(lastRunMap[p.id], 7);
          if (!bad && !stale) continue;
        } else {
          if ((h?.status ?? 'dormant') !== filters.health) continue;
        }
      }

      // Recency filter
      if (filters.recency !== 'all') {
        const lr = lastRunMap[p.id];
        const last = lr ? new Date(lr).getTime() : 0;
        const age = last ? now - last : Infinity;
        switch (filters.recency) {
          case 'today': if (age > 86_400_000) continue; break;
          case 'week': if (age > 7 * 86_400_000) continue; break;
          case 'month': if (age > 30 * 86_400_000) continue; break;
          case 'stale': if (age <= 7 * 86_400_000) continue; break;
        }
      }

      // Tag filter
      if (filters.tag) {
        const tags = smartTagsMap[p.id] ?? [];
        if (!tags.some(t => t.id === filters.tag)) continue;
      }

      ids.add(p.id);
    }
    return ids;
  }, [personas, filters, healthMap, lastRunMap, smartTagsMap]);

  return {
    filters,
    setSearch,
    setStatus,
    setModel,
    setHealth,
    setRecency,
    setTag,
    clearFilters,
    hasActiveFilters,
    filteredIds,
    smartTagsMap,
    allTags,
  };
}
