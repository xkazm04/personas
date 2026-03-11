import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Key, Plug, Trash2, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { CredentialPlaygroundModal } from '@/features/vault/sub_playground/CredentialPlaygroundModal';
import { SchemaManagerModal } from '@/features/vault/sub_databases/SchemaManagerModal';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useSimpleMode } from '@/hooks/utility/interaction/useSimpleMode';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { type CredentialListProps, capitalize } from './credentialListTypes';
import { useCredentialListFilters } from './useCredentialListFilters';
import { EmptyStateView } from './EmptyStateView';

type SortDir = 'asc' | 'desc';

interface CredRow {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
}

function HealthBadge({ success }: { success: boolean | null }) {
  if (success === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg font-medium bg-secondary/60 text-foreground/60 border border-primary/15">
        <HelpCircle className="w-3 h-3" />
        untested
      </span>
    );
  }
  if (success) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg font-medium bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border border-emerald-600/25 dark:border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" />
        healthy
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg font-medium bg-red-600/15 text-red-700 dark:text-red-400 border border-red-600/25 dark:border-red-500/20">
      <XCircle className="w-3 h-3" />
      failing
    </span>
  );
}

export function CredentialList({
  credentials,
  connectorDefinitions,
  searchTerm,
  onDelete,
  onQuickStart,
  onGoToCatalog,
  onGoToAddNew,
  onWorkspaceConnect,
}: CredentialListProps) {
  const isSimple = useSimpleMode();
  const {
    setSelectedId,
    selectedCredential,
    selectedConnector,
    selectedIsDatabase,
    filteredCredentials,
    getConnectorForType,
  } = useCredentialListFilters(credentials, connectorDefinitions, searchTerm);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');
  const [sortKey, setSortKey] = useState<string | null>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Build rows with connector info
  const allRows: CredRow[] = useMemo(
    () => filteredCredentials.map((c) => ({
      credential: c,
      connector: getConnectorForType(c.service_type),
    })),
    [filteredCredentials, getConnectorForType],
  );

  // Derive categories for filter
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    for (const r of allRows) {
      cats.add(r.connector?.category || 'other');
    }
    return [
      { value: '', label: `All Categories (${cats.size})` },
      ...Array.from(cats).sort().map((c) => ({
        value: c,
        label: capitalize(c),
      })),
    ];
  }, [allRows]);

  // Derive health options
  const healthOptions = useMemo(() => {
    return [
      { value: '', label: 'All Health' },
      { value: 'healthy', label: 'Healthy' },
      { value: 'failing', label: 'Failing' },
      { value: 'untested', label: 'Untested' },
    ];
  }, []);

  // Apply local filters + sort
  const displayRows = useMemo(() => {
    let rows = allRows;
    if (categoryFilter) {
      rows = rows.filter((r) => (r.connector?.category || 'other') === categoryFilter);
    }
    if (healthFilter) {
      rows = rows.filter((r) => {
        const s = r.credential.healthcheck_last_success;
        if (healthFilter === 'untested') return s === null;
        if (healthFilter === 'healthy') return s === true;
        if (healthFilter === 'failing') return s === false;
        return true;
      });
    }

    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        switch (sortKey) {
          case 'name':
            return dir * a.credential.name.localeCompare(b.credential.name);
          case 'type':
            return dir * (a.connector?.label || a.credential.service_type).localeCompare(b.connector?.label || b.credential.service_type);
          case 'created':
            return dir * (new Date(a.credential.created_at).getTime() - new Date(b.credential.created_at).getTime());
          default:
            return 0;
        }
      });
    }
    return rows;
  }, [allRows, categoryFilter, healthFilter, sortKey, sortDir]);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const nameColumn: DataGridColumn<CredRow> = useMemo(() => ({
    key: 'name',
    label: 'Name',
    width: isSimple ? '1fr' : '1.4fr',
    sortable: true,
    render: (row) => (
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 border"
          style={{
            backgroundColor: row.connector ? `${row.connector.color}15` : undefined,
            borderColor: row.connector ? `${row.connector.color}30` : undefined,
          }}
        >
          {row.connector?.icon_url ? (
            <ThemedConnectorIcon url={row.connector.icon_url} label={row.connector.label} color={row.connector.color} size="w-3.5 h-3.5" />
          ) : row.connector ? (
            <Plug className="w-3.5 h-3.5" style={{ color: row.connector.color }} />
          ) : (
            <Key className="w-3.5 h-3.5 text-emerald-400/80" />
          )}
        </div>
        <span className="text-sm font-medium text-foreground truncate">{row.credential.name}</span>
      </div>
    ),
  }), [isSimple]);

  const columns: DataGridColumn<CredRow>[] = useMemo(() => {
    if (isSimple) {
      return [
        nameColumn,
        {
          key: 'health',
          label: 'Status',
          width: '100px',
          render: (row) => <HealthBadge success={row.credential.healthcheck_last_success} />,
        },
      ];
    }
    return [
      nameColumn,
      {
        key: 'type',
        label: 'Type',
        width: '0.8fr',
        sortable: true,
        render: (row) => (
          <span className="text-sm text-foreground/70 truncate">{row.connector?.label || row.credential.service_type}</span>
        ),
      },
      {
        key: 'category',
        label: 'Category',
        width: '0.7fr',
        filterOptions: categoryOptions,
        filterValue: categoryFilter,
        onFilterChange: setCategoryFilter,
        render: (row) => (
          <span className="text-sm text-muted-foreground/60">{capitalize(row.connector?.category || 'other')}</span>
        ),
      },
      {
        key: 'health',
        label: 'Health',
        width: '0.6fr',
        filterOptions: healthOptions,
        filterValue: healthFilter,
        onFilterChange: setHealthFilter,
        render: (row) => <HealthBadge success={row.credential.healthcheck_last_success} />,
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
      {
        key: 'actions',
        label: '',
        width: '50px',
        align: 'right' as const,
        render: (row) => (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(row.credential.id); }}
            className="p-1 rounded-lg text-red-400/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete credential"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        ),
      },
    ];
  }, [isSimple, nameColumn, categoryOptions, categoryFilter, healthOptions, healthFilter, onDelete]);

  if (credentials.length === 0) {
    return (
      <EmptyStateView
        connectorDefinitions={connectorDefinitions}
        onQuickStart={onQuickStart}
        onGoToCatalog={onGoToCatalog}
        onGoToAddNew={onGoToAddNew}
        onWorkspaceConnect={onWorkspaceConnect}
      />
    );
  }

  return (
    <motion.div
      key="list"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col min-h-0"
    >
      <DataGrid<CredRow>
        columns={columns}
        data={displayRows}
        getRowKey={(row) => row.credential.id}
        onRowClick={(row) => setSelectedId(row.credential.id)}
        sortKey={sortKey}
        sortDirection={sortDir}
        onSort={handleSort}
        pageSize={25}
        emptyTitle="No credentials match"
        emptyDescription="Try adjusting your filters or search term"
        className="flex-1"
      />

      {/* Credential detail modal */}
      {selectedCredential && selectedIsDatabase && (
        <SchemaManagerModal
          credential={selectedCredential}
          connector={selectedConnector}
          onClose={() => setSelectedId(null)}
        />
      )}
      {selectedCredential && !selectedIsDatabase && (
        <CredentialPlaygroundModal
          credential={selectedCredential}
          connector={selectedConnector}
          onClose={() => setSelectedId(null)}
          onDelete={onDelete}
        />
      )}
    </motion.div>
  );
}
