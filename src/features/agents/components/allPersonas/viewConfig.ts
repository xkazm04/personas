/** The filter/sort/grouping state persisted in view_config JSON. */
export interface AgentListViewConfig {
  statusFilter: string;
  healthFilter: string;
  connectorFilter: string;
  favoriteOnly: boolean;
  sortKey: string | null;
  sortDirection: 'asc' | 'desc';
}

export const DEFAULT_VIEW_CONFIG: AgentListViewConfig = {
  statusFilter: 'all',
  healthFilter: 'all',
  connectorFilter: 'all',
  favoriteOnly: false,
  sortKey: 'lastRun',
  sortDirection: 'desc',
};

/**
 * Is anything narrowing the roster right now?
 *
 * One definition, because there were two and they disagreed. The page asked
 * this to decide whether to render the "no match — reset filters" empty state;
 * the toolbar asked it again, chip by chip, to show what is filtering. Neither
 * knew about `groupFilter`, which `usePersonaListFilters` nonetheless applies
 * (PersonaOverviewFilters.tsx:162-166) — so narrowing to a home team with no
 * members produced a bare empty grid with nothing to say why, and Reset
 * filters left the team filter in place.
 *
 * `groupFilter` is not part of `AgentListViewConfig` on purpose (it is not a
 * saved view preset), so it is passed alongside rather than folded in.
 */
export function hasActiveListFilter(
  view: AgentListViewConfig,
  search: string,
  groupFilter: string | null,
): boolean {
  return (
    view.statusFilter !== DEFAULT_VIEW_CONFIG.statusFilter ||
    view.healthFilter !== DEFAULT_VIEW_CONFIG.healthFilter ||
    view.connectorFilter !== DEFAULT_VIEW_CONFIG.connectorFilter ||
    view.favoriteOnly ||
    groupFilter !== null ||
    search.trim().length > 0
  );
}
