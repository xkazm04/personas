import { useState, useMemo, useCallback, useRef } from 'react';
import type { DbPersona } from '@/lib/types/types';
import type { ModelProfile } from '@/lib/types/frontendTypes';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { extractConnectorNames } from '@/lib/personas/utils';

// ── Smart Tag Types ──────────────────────────────────────────────────

export type TagCategory = 'status' | 'model' | 'health' | 'recency' | 'auto';

export interface SmartTag {
  id: string;
  label: string;
  color: string;
  category: TagCategory;
  /** Whether this tag was auto-generated (vs user-defined) */
  auto: boolean;
}

// ── Tag Vocabulary ───────────────────────────────────────────────────

const STATUS_TAGS: SmartTag[] = [
  { id: 'status:enabled', label: 'Enabled', color: '#10B981', category: 'status', auto: false },
  { id: 'status:disabled', label: 'Disabled', color: '#6B7280', category: 'status', auto: false },
];

const MODEL_TAGS: SmartTag[] = [
  { id: 'model:anthropic', label: 'Anthropic', color: '#D97706', category: 'model', auto: false },
  { id: 'model:ollama', label: 'Ollama', color: '#3B82F6', category: 'model', auto: false },
  { id: 'model:litellm', label: 'LiteLLM', color: '#8B5CF6', category: 'model', auto: false },
  { id: 'model:custom', label: 'Custom', color: '#EC4899', category: 'model', auto: false },
  { id: 'model:default', label: 'Default', color: '#6B7280', category: 'model', auto: false },
];

const HEALTH_TAGS: SmartTag[] = [
  { id: 'health:healthy', label: 'Healthy', color: '#10B981', category: 'health', auto: false },
  { id: 'health:degraded', label: 'Degraded', color: '#F59E0B', category: 'health', auto: false },
  { id: 'health:failing', label: 'Failing', color: '#EF4444', category: 'health', auto: false },
  { id: 'health:dormant', label: 'Dormant', color: '#6B7280', category: 'health', auto: false },
  { id: 'health:needs-attention', label: 'Needs Attention', color: '#F59E0B', category: 'health', auto: false },
];

const RECENCY_TAGS: SmartTag[] = [
  { id: 'recency:today', label: 'Today', color: '#10B981', category: 'recency', auto: false },
  { id: 'recency:week', label: 'This Week', color: '#3B82F6', category: 'recency', auto: false },
  { id: 'recency:month', label: 'This Month', color: '#8B5CF6', category: 'recency', auto: false },
  { id: 'recency:stale', label: 'Stale', color: '#F59E0B', category: 'recency', auto: false },
  { id: 'recency:never_run', label: 'Never Run', color: '#6B7280', category: 'recency', auto: false },
];

/** All dimension tags (non-auto) grouped by category */
export const TAG_GROUPS: { category: TagCategory; label: string; tags: SmartTag[] }[] = [
  { category: 'status', label: 'Status', tags: STATUS_TAGS },
  { category: 'model', label: 'Model', tags: MODEL_TAGS },
  { category: 'health', label: 'Health', tags: HEALTH_TAGS },
  { category: 'recency', label: 'Recency', tags: RECENCY_TAGS },
];

// ── Persona Run State ─────────────────────────────────────────────────
export type PersonaRunState = 'never_run' | 'active' | 'stale';

export function getPersonaRunState(lastRun: string | null | undefined, staleDays: number): PersonaRunState {
  if (!lastRun) return 'never_run';
  const last = new Date(lastRun).getTime();
  if (isNaN(last)) return 'never_run';
  return Date.now() - last > staleDays * 86_400_000 ? 'stale' : 'active';
}

// ── Filter State ─────────────────────────────────────────────────────

export interface FilterState {
  search: string;
  tags: Set<string>;
}

const defaultFilters: FilterState = { search: '', tags: new Set() };

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

// ── Compute all tags for a persona ───────────────────────────────────

function computePersonaTags(
  persona: DbPersona,
  health: PersonaHealth | undefined,
  lastRun: string | null | undefined,
): Set<string> {
  const tags = new Set<string>();
  const now = Date.now();

  // Status dimension
  tags.add(persona.enabled ? 'status:enabled' : 'status:disabled');

  // Model dimension
  tags.add(`model:${getProviderLabel(persona)}`);

  // Health dimension
  const healthStatus = health?.status ?? 'dormant';
  tags.add(`health:${healthStatus}`);
  const runState = getPersonaRunState(lastRun, 7);
  if (
    (health && (health.status === 'failing' || health.status === 'degraded')) ||
    runState === 'stale'
  ) {
    tags.add('health:needs-attention');
  }

  // Recency dimension
  if (runState === 'never_run') {
    tags.add('recency:never_run');
  } else if (runState === 'stale') {
    tags.add('recency:stale');
  } else if (lastRun) {
    const last = new Date(lastRun).getTime();
    const age = now - last;
    if (age <= 86_400_000) tags.add('recency:today');
    if (age <= 7 * 86_400_000) tags.add('recency:week');
    if (age <= 30 * 86_400_000) tags.add('recency:month');
  }

  // Auto tags — connector-based
  const connectors = extractConnectorNames(persona, 10);
  for (const name of connectors) {
    const lower = name.toLowerCase();
    if (lower.includes('slack')) tags.add('auto:slack');
    else if (lower.includes('github')) tags.add('auto:github');
    else if (lower.includes('jira')) tags.add('auto:jira');
    else if (lower.includes('linear')) tags.add('auto:linear');
    else if (lower.includes('notion')) tags.add('auto:notion');
    else if (lower.includes('discord')) tags.add('auto:discord');
    else if (lower.includes('supabase')) tags.add('auto:supabase');
    else if (lower.includes('postgres') || lower.includes('sql')) tags.add('auto:database');
    else tags.add(`auto:${lower}`);
  }

  // Auto tags — run state
  if (runState === 'never_run') tags.add('auto:never-run');
  if (tags.has('health:needs-attention')) tags.add('auto:needs-attention');

  return tags;
}

// ── Auto tag metadata ────────────────────────────────────────────────

const AUTO_TAG_META: Record<string, { label: string; color: string }> = {
  'auto:slack': { label: 'slack', color: '#4A154B' },
  'auto:github': { label: 'github', color: '#238636' },
  'auto:jira': { label: 'jira', color: '#0052CC' },
  'auto:linear': { label: 'linear', color: '#5E6AD2' },
  'auto:notion': { label: 'notion', color: '#000000' },
  'auto:discord': { label: 'discord', color: '#5865F2' },
  'auto:supabase': { label: 'supabase', color: '#3FCF8E' },
  'auto:database': { label: 'database', color: '#336791' },
  'auto:never-run': { label: 'never run', color: '#6B7280' },
  'auto:needs-attention': { label: 'needs attention', color: '#EF4444' },
};

function resolveAutoTag(id: string): SmartTag {
  const meta = AUTO_TAG_META[id];
  return {
    id,
    label: meta?.label ?? id.replace('auto:', ''),
    color: meta?.color ?? '#6B7280',
    category: 'auto',
    auto: true,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────

export function usePersonaFilters(
  personas: DbPersona[],
  healthMap: Record<string, PersonaHealth>,
  lastRunMap: Record<string, string | null>,
) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const tagCacheRef = useRef(new Map<string, { fingerprint: string; tags: Set<string> }>());

  const setSearch = useCallback((search: string) => setFilters(f => ({ ...f, search })), []);

  const toggleTag = useCallback((tagId: string) => {
    setFilters(f => {
      const next = new Set(f.tags);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        // Within same category, replace (radio behavior)
        const category = tagId.split(':')[0] as TagCategory;
        if (category !== 'auto') {
          for (const existing of next) {
            if (existing.startsWith(`${category}:`)) {
              next.delete(existing);
            }
          }
        }
        next.add(tagId);
      }
      return { ...f, tags: next };
    });
  }, []);

  const clearFilters = useCallback(() => setFilters(defaultFilters), []);

  const hasActiveFilters = filters.search !== '' || filters.tags.size > 0;

  // Build per-persona tag sets
  const personaTagsMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const p of personas) {
      const health = healthMap[p.id];
      const lastRun = lastRunMap[p.id];
      const connectorFingerprint = extractConnectorNames(p, 10).join('|').toLowerCase();
      const fingerprint = `${p.enabled}::${p.model_profile ?? ''}::${connectorFingerprint}::${health?.status ?? 'none'}::${lastRun ?? 'never'}`;

      const cached = tagCacheRef.current.get(p.id);
      if (cached && cached.fingerprint === fingerprint) {
        map[p.id] = cached.tags;
        continue;
      }

      const tags = computePersonaTags(p, health, lastRun);
      tagCacheRef.current.set(p.id, { fingerprint, tags });
      map[p.id] = tags;
    }
    // Prune cache entries for deleted personas
    const currentIds = new Set(personas.map(p => p.id));
    for (const key of tagCacheRef.current.keys()) {
      if (!currentIds.has(key)) tagCacheRef.current.delete(key);
    }
    return map;
  }, [personas, healthMap, lastRunMap]);

  // Build SmartTag[] map for backward compat (auto tags only, for display)
  const smartTagsMap = useMemo(() => {
    const map: Record<string, SmartTag[]> = {};
    for (const [pid, tagSet] of Object.entries(personaTagsMap)) {
      map[pid] = Array.from(tagSet)
        .filter(id => id.startsWith('auto:'))
        .map(resolveAutoTag);
    }
    return map;
  }, [personaTagsMap]);

  // Collect all unique auto tags for the tag chip palette
  const allAutoTags = useMemo(() => {
    const tagMap = new Map<string, SmartTag>();
    for (const tags of Object.values(smartTagsMap)) {
      for (const t of tags) {
        if (!tagMap.has(t.id)) tagMap.set(t.id, t);
      }
    }
    return Array.from(tagMap.values());
  }, [smartTagsMap]);

  // All tags available for filtering (dimension + auto)
  const allTags = useMemo(() => {
    const result: SmartTag[] = [];
    for (const group of TAG_GROUPS) {
      result.push(...group.tags);
    }
    result.push(...allAutoTags);
    return result;
  }, [allAutoTags]);

  // Filter personas — single tag-intersection operation
  const filteredIds = useMemo(() => {
    const query = filters.search.toLowerCase().trim();
    const activeTags = filters.tags;

    const ids = new Set<string>();
    for (const p of personas) {
      // Search filter
      if (query) {
        const haystack = [p.name, p.description ?? '', p.system_prompt ?? ''].join(' ').toLowerCase();
        if (!haystack.includes(query)) continue;
      }

      // Tag intersection: persona must have ALL active tags
      if (activeTags.size > 0) {
        const pTags = personaTagsMap[p.id];
        if (!pTags) continue;
        let match = true;
        for (const tag of activeTags) {
          if (!pTags.has(tag)) { match = false; break; }
        }
        if (!match) continue;
      }

      ids.add(p.id);
    }
    return ids;
  }, [personas, filters, personaTagsMap]);

  return {
    filters,
    setSearch,
    toggleTag,
    clearFilters,
    hasActiveFilters,
    filteredIds,
    smartTagsMap,
    allTags,
    allAutoTags,
    /** Lookup: is a dimension tag relevant (any persona has it)? */
    personaTagsMap,
  };
}
