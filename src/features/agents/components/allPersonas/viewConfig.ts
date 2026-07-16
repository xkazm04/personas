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
