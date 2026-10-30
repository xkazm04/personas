import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createDedupedJSONStorage } from '@/stores/util/dedupedStorage';
import { DEFAULT_VIEW_CONFIG, type AgentListViewConfig } from './viewConfig';
import { ROSTER_SORT_KEYS } from './usePersonaFilterOptions';

const STATUS_VALUES = ['all', 'enabled', 'disabled', 'building', 'archived'];
const HEALTH_VALUES = ['all', 'healthy', 'degraded', 'failing', 'dormant'];

/**
 * Rebuild a persisted view against today's vocabularies. A value a later build
 * no longer knows (a retired sort key, a renamed status) falls back to the
 * default for THAT field instead of landing the roster in a state no control
 * can show. The connector filter is free text (connector names come and go);
 * a stale one only narrows to an empty roster whose empty state offers reset.
 */
export function sanitizeRosterView(raw: unknown): AgentListViewConfig {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_VIEW_CONFIG;
  const oneOf = (x: unknown, allowed: readonly string[], fallback: string) =>
    typeof x === 'string' && allowed.includes(x) ? x : fallback;
  return {
    statusFilter: oneOf(v.statusFilter, STATUS_VALUES, d.statusFilter),
    healthFilter: oneOf(v.healthFilter, HEALTH_VALUES, d.healthFilter),
    connectorFilter: typeof v.connectorFilter === 'string' && v.connectorFilter ? v.connectorFilter : d.connectorFilter,
    favoriteOnly: typeof v.favoriteOnly === 'boolean' ? v.favoriteOnly : d.favoriteOnly,
    sortKey: v.sortKey === null ? null : oneOf(v.sortKey, ROSTER_SORT_KEYS, d.sortKey ?? 'lastRun'),
    sortDirection: v.sortDirection === 'asc' || v.sortDirection === 'desc' ? v.sortDirection : d.sortDirection,
  };
}

interface RosterViewState {
  view: AgentListViewConfig;
  setView: (next: AgentListViewConfig | ((prev: AgentListViewConfig) => AgentListViewConfig)) => void;
  resetView: () => void;
}

/**
 * The All-Personas roster's sort, filters and favorites toggle, remembered
 * across visits and restarts on this machine (the app is single-user and
 * local-first, so the device profile is the user). Search text and the team
 * rail's selection are deliberately NOT kept: a remembered search hides rows
 * without saying why, and a team id can vanish between sessions.
 */
export const useRosterViewStore = create<RosterViewState>()(
  persist(
    (set) => ({
      view: DEFAULT_VIEW_CONFIG,
      setView: (next) => set((s) => ({ view: typeof next === 'function' ? next(s.view) : next })),
      resetView: () => set({ view: DEFAULT_VIEW_CONFIG }),
    }),
    {
      name: 'persona-roster-view',
      storage: createDedupedJSONStorage(),
      partialize: (s) => ({ view: s.view }),
      merge: (persisted, current) => ({
        ...current,
        view: sanitizeRosterView((persisted as { view?: unknown } | undefined)?.view),
      }),
    },
  ),
);
