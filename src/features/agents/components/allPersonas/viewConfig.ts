/**
 * The filter/sort state of the All-Personas roster. Persisted per device by
 * `rosterViewStore` (localStorage key `persona-roster-view`, sanitised against
 * today's vocabularies on load) so a repeat visit keeps the view it was left
 * in. Unrelated to the `view_config` JSON column, which belongs to the Events
 * page's saved views.
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
