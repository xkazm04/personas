import { useMemo } from 'react';
import { Database, Table2, Code2 } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';

export interface DbRow {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  tableCount: number;
  queryCount: number;
}

export function useDbGridColumns(
  typeOptions: { value: string; label: string }[],
  typeFilter: string,
  setTypeFilter: (v: string) => void,
): DataGridColumn<DbRow>[] {
  const { t } = useTranslation();
  const db = t.vault.databases;
  return useMemo(() => [
    {
      key: 'name',
      label: db.col_database,
      width: '1.5fr',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-6 h-6 rounded-input flex items-center justify-center border border-primary/15 shrink-0"
            style={{ backgroundColor: `${row.connector?.color || '#6B7280'}15` }}
          >
            {row.connector?.icon_url ? (
              <ThemedConnectorIcon url={row.connector.icon_url} label={row.connector.label} color={row.connector.color} size="w-3.5 h-3.5" />
            ) : (
              <Database className="w-3.5 h-3.5 text-blue-400/60" />
            )}
          </div>
          <span className="text-sm font-medium text-foreground truncate">{row.credential.name}</span>
        </div>
      ),
    },
    {
      key: 'type',
      label: db.col_type,
      width: '0.8fr',
      filterOptions: typeOptions,
      filterValue: typeFilter,
      onFilterChange: setTypeFilter,
      render: (row) => (
        <span className="text-sm text-foreground truncate">{row.connector?.label || row.credential.service_type}</span>
      ),
    },
    {
      key: 'tables',
      label: db.col_tables,
      width: '0.5fr',
      sortable: true,
      render: (row) => row.tableCount > 0 ? (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-card bg-blue-500/10 text-blue-400/80">
          <Table2 className="w-3 h-3" />
          {row.tableCount}
        </span>
      ) : (
        <span className="text-xs text-foreground">--</span>
      ),
    },
    {
      key: 'queries',
      label: db.col_queries,
      width: '0.5fr',
      sortable: true,
      render: (row) => row.queryCount > 0 ? (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-card bg-violet-500/10 text-violet-400/80">
          <Code2 className="w-3 h-3" />
          {row.queryCount}
        </span>
      ) : (
        <span className="text-xs text-foreground">--</span>
      ),
    },
    {
      key: 'created',
      label: db.col_created,
      width: '0.7fr',
      sortable: true,
      align: 'right' as const,
      render: (row) => (
        <span className="text-sm text-foreground">{formatRelativeTime(row.credential.created_at)}</span>
      ),
    },
  ], [typeOptions, typeFilter, setTypeFilter, db]);
}
