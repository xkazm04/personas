import { useMemo } from 'react';
import { extractConnectorNames } from '@/lib/personas/utils';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import type { AgentListViewConfig } from './viewConfig';

const connectorNamesCache = new WeakMap<Persona, string[]>();

function getCachedConnectorNames(persona: Persona): string[] {
  let names = connectorNamesCache.get(persona);
  if (!names) {
    names = extractConnectorNames(persona, 10);
    connectorNamesCache.set(persona, names);
  }
  return names;
}

interface UsePersonaListFiltersArgs {
  personas: Persona[];
  view: AgentListViewConfig;
  search: string;
  triggerCounts: Record<string, number>;
  lastRunMap: Record<string, string | null>;
  /** Month-to-date spend per persona, from the budget-enforcement slice. The
   *  roster's money column sorts on it; optional so surfaces that never show
   *  the column (config table, tests) can leave it out. */
  spendMap?: Map<string, { spend: number }>;
  healthMap: Record<string, PersonaHealth | undefined>;
  isBuilding: (id: string) => boolean;
  isDraft: (p: Persona) => boolean;
  /** Lifecycle `archived` predicate. Archived personas are hidden from the
   *  default roster and shown only when `statusFilter === 'archived'`. */
  isArchived: (p: Persona) => boolean;
  isFavorite: (id: string) => boolean;
  /**
   * Home-team filter from PersonaGroupDropRail (cycle 19; repointed to
   * home teams in the Groups→Teams consolidation). `null` = unfiltered;
   * a team id narrows to personas with that home team; the literal
   * `'__ungrouped__'` narrows to personas without a `home_team_id`.
   */
  groupFilter: string | null;
}

export interface UsePersonaListFiltersResult {
  /** Filter+sort applied list of personas. */
  data: Persona[];
  /** Map of persona id → connector display names (memoised once per personas array). */
  connectorNamesMap: Map<string, string[]>;
  /** All unique connector names across personas, sorted asc. */
  allConnectorNames: string[];
}

/**
 * Centralised filter+sort logic for the persona overview table.
 *
 * Pulled out of the page component so the filtering pipeline is independently
 * testable - see `__tests__/usePersonaListFilters.test.ts`.
 */
export function usePersonaListFilters({
  personas,
  view,
  search,
  triggerCounts,
  lastRunMap,
  spendMap,
  healthMap,
  isBuilding,
  isDraft,
  isArchived,
  isFavorite,
  groupFilter,
}: UsePersonaListFiltersArgs): UsePersonaListFiltersResult {
  const { statusFilter, healthFilter, connectorFilter, favoriteOnly, sortKey, sortDirection } = view;

  // Pre-compute connector names per persona once to avoid redundant JSON.parse calls.
  // The WeakMap keeps connector extraction scoped to the persona object that changed
  // instead of re-parsing every persona when the array identity shifts.
  const connectorNamesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of personas) map.set(p.id, getCachedConnectorNames(p));
    return map;
  }, [personas]);

  const allConnectorNames = useMemo(() => {
    const names = new Set<string>();
    for (const list of connectorNamesMap.values()) for (const c of list) names.add(c);
    return [...names].sort();
  }, [connectorNamesMap]);

  const sortedPersonas = useMemo(() => {
    const result = [...personas];

    if (!sortKey) return result;

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'status':
          cmp = (a.enabled ? 1 : 0) - (b.enabled ? 1 : 0);
          break;
        case 'trust':
          cmp = (a.trust_score ?? 0) - (b.trust_score ?? 0);
          break;
        case 'triggers':
          cmp = (triggerCounts[a.id] ?? 0) - (triggerCounts[b.id] ?? 0);
          break;
        case 'lastRun': {
          const ta = lastRunMap[a.id] ?? '';
          const tb = lastRunMap[b.id] ?? '';
          cmp = ta.localeCompare(tb);
          break;
        }
        case 'spend': {
          const sa = spendMap?.get(a.id)?.spend;
          const sb = spendMap?.get(b.id)?.spend;
          // UNKNOWN IS NOT FREE (golden path: llm-spend-accounting). Defaulting
          // a missing figure to 0 would rank an agent whose spend nobody could
          // report alongside one that genuinely cost nothing, and the cheapest
          // row on the screen would be the one with no data. Unknown sorts
          // after every known figure instead, in BOTH directions - pre-negated
          // here because the caller flips `cmp` for a descending sort.
          if (sa === undefined || sb === undefined) {
            if (sa === undefined && sb === undefined) cmp = 0;
            else {
              const dir = sortDirection === 'desc' ? -1 : 1;
              cmp = (sa === undefined ? 1 : -1) * dir;
            }
            break;
          }
          cmp = sa - sb;
          break;
        }
        case 'created':
          cmp = (a.created_at ?? '').localeCompare(b.created_at ?? '');
          break;
      }
      return sortDirection === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [personas, sortKey, sortDirection, triggerCounts, lastRunMap, spendMap]);

  const data = useMemo(() => {
    let result = sortedPersonas;

    // Quick name/description search
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description?.toLowerCase().includes(q) ?? false),
      );
    }

    // Archived personas are hidden from every view EXCEPT the dedicated
    // Archived view (`statusFilter === 'archived'`), which shows only them.
    if (statusFilter === 'archived') {
      result = result.filter((p) => isArchived(p));
    } else {
      result = result.filter((p) => !isArchived(p));
    }

    // Status
    if (statusFilter === 'enabled') result = result.filter((p) => p.enabled && !isDraft(p));
    else if (statusFilter === 'disabled') result = result.filter((p) => !p.enabled);
    else if (statusFilter === 'building') result = result.filter((p) => isBuilding(p.id) || isDraft(p));

    // Health
    if (healthFilter !== 'all') {
      result = result.filter((p) => (healthMap[p.id]?.status ?? 'healthy') === healthFilter);
    }

    // Connector
    if (connectorFilter !== 'all') {
      result = result.filter((p) => (connectorNamesMap.get(p.id) ?? []).includes(connectorFilter));
    }

    // Favorites
    if (favoriteOnly) result = result.filter((p) => isFavorite(p.id));

    // Home team / workspace (PersonaGroupDropRail chip selection — cycle 19,
    // repointed to home_team_id in the Groups→Teams consolidation)
    if (groupFilter === '__ungrouped__') {
      result = result.filter((p) => !p.home_team_id);
    } else if (groupFilter) {
      result = result.filter((p) => p.home_team_id === groupFilter);
    }

    return result;
  }, [
    sortedPersonas,
    search,
    statusFilter,
    healthFilter,
    connectorFilter,
    favoriteOnly,
    isBuilding,
    isDraft,
    isArchived,
    isFavorite,
    healthMap,
    connectorNamesMap,
    groupFilter,
  ]);

  return { data, connectorNamesMap, allConnectorNames };
}
