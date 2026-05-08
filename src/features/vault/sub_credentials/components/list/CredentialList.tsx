import { useMemo, useCallback } from 'react';
import { useVaultStore } from '@/stores/vaultStore';
import { DataGrid } from '@/features/shared/components/display/DataGrid';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { type CredentialListProps, type SortKey, type HealthFilter, capitalize } from './credentialListTypes';
import { useCredentialListFilters } from './useCredentialListFilters';
import { EmptyStateView } from './EmptyStateView';
import { type CredRow, useCredentialColumns } from './CredentialListColumns';
import { CredentialDetailModals } from './CredentialDetailModals';
import { useTranslation } from '@/i18n/useTranslation';
import { useDensity } from '@/hooks/utility/data/useDensity';
import { DensityToggle } from '@/features/shared/components/display/DensityToggle';

const SORT_KEYS: ReadonlySet<string> = new Set(['name', 'type', 'created', 'last-used', 'health']);
const HEALTH_FILTERS: ReadonlySet<string> = new Set(['', 'healthy', 'failing', 'untested']);

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
  const { density, setDensity } = useDensity('credential-list');
  const {
    setSelectedId,
    selectedCredential,
    selectedConnector,
    selectedIsDatabase,
    filteredCredentials,
    getConnectorForType,
    healthFilter,
    setHealthFilter,
    categoryFilter,
    setCategoryFilter,
    sortKey,
    setSortKey,
    sortDirection,
    setSortDirection,
  } = useCredentialListFilters(credentials, connectorDefinitions, searchTerm);

  // Build rows from the hook's already-filtered+sorted credentials list.
  const displayRows: CredRow[] = useMemo(
    () => filteredCredentials.map((c) => ({
      credential: c,
      connector: getConnectorForType(c.service_type),
    })),
    [filteredCredentials, getConnectorForType],
  );

  // Derive categories from the unfiltered set so the dropdown stays stable
  // when the user toggles a category.
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    for (const c of credentials) {
      cats.add(getConnectorForType(c.service_type)?.category || 'other');
    }
    return [
      { value: '', label: `All Categories (${cats.size})` },
      ...Array.from(cats).sort().map((c) => ({
        value: c,
        label: capitalize(c),
      })),
    ];
  }, [credentials, getConnectorForType]);

  const healthOptions = useMemo(() => [
    { value: '', label: 'All Health' },
    { value: 'healthy', label: 'Healthy' },
    { value: 'failing', label: 'Failing' },
    { value: 'untested', label: 'Untested' },
  ], []);

  // The DataGrid's column-filter controls expose plain string state. Convert
  // the empty-string "all" sentinel to/from the hook's HealthFilter union.
  const healthFilterStr = healthFilter === 'all' ? '' : healthFilter;
  const setHealthFilterStr = useCallback((v: string) => {
    setHealthFilter(HEALTH_FILTERS.has(v) ? ((v || 'all') as HealthFilter) : 'all');
  }, [setHealthFilter]);

  const handleSort = useCallback((key: string) => {
    if (!SORT_KEYS.has(key)) return;
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key as SortKey);
      setSortDirection('asc');
    }
  }, [sortKey, sortDirection, setSortKey, setSortDirection]);

  const columns = useCredentialColumns({
    isSimple,
    pendingDeleteIds,
    categoryOptions,
    categoryFilter,
    setCategoryFilter,
    healthOptions,
    healthFilter: healthFilterStr,
    setHealthFilter: setHealthFilterStr,
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
      <div className="flex justify-end px-3 py-2">
        <DensityToggle density={density} onChange={setDensity} scopeId="credential-list" />
      </div>
      <DataGrid<CredRow>
        columns={columns}
        data={displayRows}
        getRowKey={(row) => row.credential.id}
        onRowClick={(row) => { if (!pendingDeleteIds.has(row.credential.id)) setSelectedId(row.credential.id); }}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={handleSort}
        pageSize={25}
        emptyTitle={t.vault.credential_list.no_match}
        emptyDescription={t.vault.credential_list.no_match_hint}
        className="flex-1"
        density={density}
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
