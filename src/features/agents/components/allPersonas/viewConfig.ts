/**
 * The filter/sort state of the All-Personas roster. Held in component state
 * for the life of the page (it is NOT persisted — the `view_config` JSON
 * column belongs to the Events page's saved views, not to this list).
 */
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
 * Whether anything is narrowing the roster right now. ONE definition, shared
 * by the "no personas match these filters" branch and the reset action, so
 * the two cannot disagree about what counts as a filter.
 *
 * `groupFilter` is the team dropdown (PersonaGroupDropRail): `null` is
 * unfiltered, a team id or the `'__ungrouped__'` sentinel narrows. It lives
 * outside `AgentListViewConfig` (it is not part of the view preset) and was
 * therefore missing from the old inline check — a team with zero members
 * produced the grid's generic "No data" instead of the filter empty state,
 * and "Clear all filters" left the team selected.
 */
export function hasActiveFilters(
  view: AgentListViewConfig,
  search: string,
  groupFilter: string | null,
): boolean {
  return (
    view.statusFilter !== 'all' ||
    view.healthFilter !== 'all' ||
    view.connectorFilter !== 'all' ||
    view.favoriteOnly ||
    search.trim().length > 0 ||
    groupFilter !== null
  );
}
