import { useState, useMemo, useCallback } from 'react';
import { useVaultStore } from '@/stores/vaultStore';
import { DataGrid } from '@/features/shared/components/display/DataGrid';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { type CredentialListProps, capitalize } from './credentialListTypes';
import { useCredentialListFilters } from './useCredentialListFilters';
import { EmptyStateView } from './EmptyStateView';
import { type CredRow, useCredentialColumns } from './CredentialListColumns';
import { CredentialDetailModals } from './CredentialDetailModals';
import { useTranslation } from '@/i18n/useTranslation';

type SortDir = 'asc' | 'desc';

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
  const { t } = useTranslation();
  const { isStarter: isSimple } = useTier();
  const pendingDeleteIds = useVaultStore((s) => s.pendingDeleteCredentialIds);
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

  const healthOptions = useMemo(() => [
    { value: '', label: 'All Health' },
    { value: 'healthy', label: 'Healthy' },
    { value: 'failing', label: 'Failing' },
    { value: 'untested', label: 'Untested' },
  ], []);

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

  const columns = useCredentialColumns({
    isSimple,
    pendingDeleteIds,
    categoryOptions,
    categoryFilter,
    setCategoryFilter,
    healthOptions,
    healthFilter,
    setHealthFilter,
    onDelete,
  });

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
    <div
      key="list"
      data-testid="credential-list"
      className="animate-fade-slide-in flex flex-col min-h-0"
    >
      <DataGrid<CredRow>
        columns={columns}
        data={displayRows}
        getRowKey={(row) => row.credential.id}
        onRowClick={(row) => { if (!pendingDeleteIds.has(row.credential.id)) setSelectedId(row.credential.id); }}
        sortKey={sortKey}
        sortDirection={sortDir}
        onSort={handleSort}
        pageSize={25}
        emptyTitle={t.vault.credential_list.no_match}
        emptyDescription={t.vault.credential_list.no_match_hint}
        className="flex-1"
      />

      <CredentialDetailModals
        selectedCredential={selectedCredential}
        selectedConnector={selectedConnector}
        selectedIsDatabase={selectedIsDatabase}
        onClose={() => setSelectedId(null)}
        onDelete={onDelete}
      />
    </div>
  );
}
