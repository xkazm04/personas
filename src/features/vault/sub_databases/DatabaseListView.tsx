import { useState, useMemo, useCallback } from 'react';
import { Database, Table2, Code2 } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { useVaultStore } from "@/stores/vaultStore";
import { formatRelativeTime } from '@/lib/utils/formatters';
import { SchemaManagerModal } from './SchemaManagerModal';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface DatabaseListViewProps {
  onBack: () => void;
}

type SortDir = 'asc' | 'desc';

interface DbRow {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  tableCount: number;
  queryCount: number;
}

export function DatabaseListView({ onBack: _onBack }: DatabaseListViewProps) {
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const dbSchemaTables = useVaultStore((s) => s.dbSchemaTables);
  const dbSavedQueries = useVaultStore((s) => s.dbSavedQueries);

  const [selectedCredential, setSelectedCredential] = useState<CredentialMetadata | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [sortKey, setSortKey] = useState<string | null>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Build rows: filter to database credentials, enrich with counts
  const allRows: DbRow[] = useMemo(() => {
    const connectorByName = new Map(connectorDefinitions.map((d) => [d.name, d]));

    const tableCountByCredential = new Map<string, number>();
    for (const t of dbSchemaTables) {
      tableCountByCredential.set(t.credential_id, (tableCountByCredential.get(t.credential_id) || 0) + 1);
    }

    const queryCountByCredential = new Map<string, number>();
    for (const q of dbSavedQueries) {
      queryCountByCredential.set(q.credential_id, (queryCountByCredential.get(q.credential_id) || 0) + 1);
    }

    return credentials
      .filter((c) => connectorByName.get(c.service_type)?.category === 'database')
      .map((c) => ({
        credential: c,
        connector: connectorByName.get(c.service_type),
        tableCount: tableCountByCredential.get(c.id) || 0,
        queryCount: queryCountByCredential.get(c.id) || 0,
      }));
  }, [credentials, connectorDefinitions, dbSchemaTables, dbSavedQueries]);

  // Type filter options
  const typeOptions = useMemo(() => {
    const types = new Map<string, string>();
    for (const r of allRows) {
      const label = r.connector?.label || r.credential.service_type;
      types.set(r.credential.service_type, label);
    }
    return [
      { value: '', label: `All Types (${types.size})` },
      ...Array.from(types.entries()).sort(([, a], [, b]) => a.localeCompare(b)).map(([val, lab]) => ({
        value: val,
        label: lab,
      })),
    ];
  }, [allRows]);

  // Filter + sort
  const displayRows = useMemo(() => {
    let rows = allRows;
    if (typeFilter) {
      rows = rows.filter((r) => r.credential.service_type === typeFilter);
    }
    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        switch (sortKey) {
          case 'name':
            return dir * a.credential.name.localeCompare(b.credential.name);
          case 'tables':
            return dir * (a.tableCount - b.tableCount);
          case 'queries':
            return dir * (a.queryCount - b.queryCount);
          case 'created':
            return dir * (new Date(a.credential.created_at).getTime() - new Date(b.credential.created_at).getTime());
          default:
            return 0;
        }
      });
    }
    return rows;
  }, [allRows, typeFilter, sortKey, sortDir]);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const columns: DataGridColumn<DbRow>[] = useMemo(() => [
    {
      key: 'name',
      label: 'Database',
      width: '1.5fr',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center border border-primary/15 shrink-0"
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
      label: 'Type',
      width: '0.8fr',
      filterOptions: typeOptions,
      filterValue: typeFilter,
      onFilterChange: setTypeFilter,
      render: (row) => (
        <span className="text-sm text-foreground/70 truncate">{row.connector?.label || row.credential.service_type}</span>
      ),
    },
    {
      key: 'tables',
      label: 'Tables',
      width: '0.5fr',
      sortable: true,
      render: (row) => row.tableCount > 0 ? (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-lg bg-blue-500/10 text-blue-400/80">
          <Table2 className="w-3 h-3" />
          {row.tableCount}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/40">--</span>
      ),
    },
    {
      key: 'queries',
      label: 'Queries',
      width: '0.5fr',
      sortable: true,
      render: (row) => row.queryCount > 0 ? (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-lg bg-violet-500/10 text-violet-400/80">
          <Code2 className="w-3 h-3" />
          {row.queryCount}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/40">--</span>
      ),
    },
    {
      key: 'created',
      label: 'Created',
      width: '0.7fr',
      sortable: true,
      align: 'right' as const,
      render: (row) => (
        <span className="text-sm text-foreground/60">{formatRelativeTime(row.credential.created_at)}</span>
      ),
    },
  ], [typeOptions, typeFilter]);

  if (allRows.length === 0) {
    return (
      <div className="animate-fade-slide-in"
      >
        <EmptyIllustration
          icon={Database}
          heading="No database credentials"
          description="Add database credentials from the Catalog to manage schemas and run queries."
          className="py-20"
        />
      </div>
    );
  }

  return (
    <>
      <div
        className="animate-fade-slide-in flex flex-col min-h-0"
      >
        <DataGrid<DbRow>
          columns={columns}
          data={displayRows}
          getRowKey={(row) => row.credential.id}
          onRowClick={(row) => setSelectedCredential(row.credential)}
          sortKey={sortKey}
          sortDirection={sortDir}
          onSort={handleSort}
          emptyIcon={Database}
          emptyTitle="No matching databases"
          emptyDescription="Try changing the type filter"
          className="flex-1"
        />
      </div>

      {selectedCredential && (
        <SchemaManagerModal
          credential={selectedCredential}
          connector={connectorDefinitions.find((d) => d.name === selectedCredential.service_type)}
          onClose={() => setSelectedCredential(null)}
        />
      )}
    </>
  );
}
