import { useState, useMemo, useCallback, useRef } from 'react';
import type { Persona } from '@/lib/types/types';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { extractConnectorNames } from '@/lib/personas/utils';
import {
  type TagCategory,
  type SmartTag,
  type FilterState,
  defaultFilters,
  TAG_GROUPS,
  computePersonaTags,
  resolveAutoTag,
} from './filterHelpers';

// Re-export types and constants for backward compatibility
export type { TagCategory, SmartTag, FilterState };
export { TAG_GROUPS, defaultFilters };
export { getPersonaRunState, type PersonaRunState } from './filterHelpers';

// -- Hook -------------------------------------------------------------

export function usePersonaFilters(
  personas: Persona[],
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
        const category = tagId.split(':')[0] as TagCategory;
        if (category !== 'auto') {
          for (const existing of next) {
            if (existing.startsWith(`${category}:`)) next.delete(existing);
          }
        }
        next.add(tagId);
      }
      return { ...f, tags: next };
    });
  }, []);

  const clearFilters = useCallback(() => setFilters(defaultFilters), []);
  const hasActiveFilters = filters.search !== '' || filters.tags.size > 0;

  const personaTagsMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const p of personas) {
      const health = healthMap[p.id];
      const lastRun = lastRunMap[p.id];
      const connectorFingerprint = extractConnectorNames(p, 10).join('|').toLowerCase();
      const fingerprint = `${p.enabled}::${p.model_profile ?? ''}::${connectorFingerprint}::${health?.status ?? 'none'}::${lastRun ?? 'never'}`;

      const cached = tagCacheRef.current.get(p.id);
      if (cached && cached.fingerprint === fingerprint) { map[p.id] = cached.tags; continue; }

      const tags = computePersonaTags(p, health, lastRun);
      tagCacheRef.current.set(p.id, { fingerprint, tags });
      map[p.id] = tags;
    }
    return map;
  }, [personas, healthMap, lastRunMap]);

  const smartTagsMap = useMemo(() => {
    const map: Record<string, SmartTag[]> = {};
    for (const [pid, tagSet] of Object.entries(personaTagsMap)) {
      map[pid] = Array.from(tagSet).filter(id => id.startsWith('auto:')).map(resolveAutoTag);
    }
    return map;
  }, [personaTagsMap]);

  const allAutoTags = useMemo(() => {
    const tagMap = new Map<string, SmartTag>();
    for (const tags of Object.values(smartTagsMap)) {
      for (const t of tags) { if (!tagMap.has(t.id)) tagMap.set(t.id, t); }
    }
    return Array.from(tagMap.values());
  }, [smartTagsMap]);

  const allTags = useMemo(() => {
    const result: SmartTag[] = [];
    for (const group of TAG_GROUPS) result.push(...group.tags);
    result.push(...allAutoTags);
    return result;
  }, [allAutoTags]);

  const filteredIds = useMemo(() => {
    const query = filters.search.toLowerCase().trim();
    const activeTags = filters.tags;
    const ids = new Set<string>();
    for (const p of personas) {
      if (query) {
        const haystack = [p.name, p.description ?? '', p.system_prompt ?? ''].join(' ').toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      if (activeTags.size > 0) {
        const pTags = personaTagsMap[p.id];
        if (!pTags) continue;
        let match = true;
        for (const tag of activeTags) { if (!pTags.has(tag)) { match = false; break; } }
        if (!match) continue;
      }
      ids.add(p.id);
    }
    return ids;
  }, [personas, filters, personaTagsMap]);

  return {
    filters, setSearch, toggleTag, clearFilters, hasActiveFilters,
    filteredIds, smartTagsMap, allTags, allAutoTags, personaTagsMap,
  };
}
