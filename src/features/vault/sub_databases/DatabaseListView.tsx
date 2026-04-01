import { useState, useMemo, useCallback } from 'react';
import { Database } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { DataGrid } from '@/features/shared/components/display/DataGrid';
import { useVaultStore } from "@/stores/vaultStore";
import { SchemaManagerModal } from './SchemaManagerModal';
import { useDbGridColumns, type DbRow } from './DBGrid';
import type { CredentialMetadata } from '@/lib/types/types';

interface DatabaseListViewProps {
  onBack: () => void;
}

type SortDir = 'asc' | 'desc';

export function DatabaseListView({ onBack: _onBack }: DatabaseListViewProps) {
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const dbSchemaTables = useVaultStore((s) => s.dbSchemaTables);
  const dbSavedQueries = useVaultStore((s) => s.dbSavedQueries);

  const [selectedCredential, setSelectedCredential] = useState<CredentialMetadata | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [sortKey, setSortKey] = useState<string | null>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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

  const typeOptions = useMemo(() => {
    const types = new Map<string, string>();
    for (const r of allRows) {
      const label = r.connector?.label || r.credential.service_type;
      types.set(r.credential.service_type, label);
    }
    return [
      { value: '', label: `All Types (${types.size})` },
      ...Array.from(types.entries()).sort(([, a], [, b]) => a.localeCompare(b)).map(([val, lab]) => ({ value: val, label: lab })),
    ];
  }, [allRows]);

  const displayRows = useMemo(() => {
    let rows = allRows;
    if (typeFilter) rows = rows.filter((r) => r.credential.service_type === typeFilter);
    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        switch (sortKey) {
          case 'name': return dir * a.credential.name.localeCompare(b.credential.name);
          case 'tables': return dir * (a.tableCount - b.tableCount);
          case 'queries': return dir * (a.queryCount - b.queryCount);
          case 'created': return dir * (new Date(a.credential.created_at).getTime() - new Date(b.credential.created_at).getTime());
          default: return 0;
        }
      });
    }
    return rows;
  }, [allRows, typeFilter, sortKey, sortDir]);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);

  const columns = useDbGridColumns(typeOptions, typeFilter, setTypeFilter);

  if (allRows.length === 0) {
    return (
      <div className="animate-fade-slide-in">
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
      <div className="animate-fade-slide-in flex flex-col min-h-0">
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
