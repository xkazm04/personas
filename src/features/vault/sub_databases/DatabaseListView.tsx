import { useState, useMemo, useCallback } from 'react';
import { Database } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { DataGrid } from '@/features/shared/components/display/DataGrid';
import { useVaultStore } from "@/stores/vaultStore";
import { useTranslation } from '@/i18n/useTranslation';
import { SchemaManagerModal } from './SchemaManagerModal';
import { useDbGridColumns, type DbRow } from './DBGrid';
import type { CredentialMetadata } from '@/lib/types/types';
import { connectorCategoryTags } from '@/lib/credentials/builtinConnectors';

interface DatabaseListViewProps {
  onBack: () => void;
  /**
   * True while the manager's initial (or a manual re-)fetch of credentials /
   * connector definitions is in flight — this view doesn't fetch its own
   * rows, it filters the manager's already-loaded `credentials` down to the
   * database category. Gates ONLY the empty-region decision (settled-only
   * empty illustration vs. delayed ghost rows); rows already on screen are
   * never hidden. See docs/design/overview-loading.md.
   */
  isFetching?: boolean;
}

type SortDir = 'asc' | 'desc';

export function DatabaseListView({ onBack: _onBack, isFetching = false }: DatabaseListViewProps) {
  const { t, tx } = useTranslation();
  const db = t.vault.databases;
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
    // `dbSchemaTables` is the user's PINNED schema bookmarks, not an
    // introspection of the live database. Named for what it is, so the next
    // reader cannot mistake it for the database's own table count.
    //
    // Kept `...Count...` in the name deliberately: the census rule
    // `absent-entity-count-as-zero` keys on that word, and renaming the
    // variable would drop this baselined site from its population without
    // changing what the code does. (The default is sound here -- the map is
    // built from the whole of `dbSchemaTables` in this same pass, so a
    // credential that is absent genuinely has no pins.)
    const pinnedTableCountByCredential = new Map<string, number>();
    for (const t of dbSchemaTables) {
      pinnedTableCountByCredential.set(t.credential_id, (pinnedTableCountByCredential.get(t.credential_id) || 0) + 1);
    }
    const queryCountByCredential = new Map<string, number>();
    for (const q of dbSavedQueries) {
      queryCountByCredential.set(q.credential_id, (queryCountByCredential.get(q.credential_id) || 0) + 1);
    }
    return credentials
      // A connector's coarse `category` is a single bucket — Airtable is
      // `spreadsheet`, Notion is `knowledge_base` — while both ALSO tag
      // `database` in the multi-tag list and both are first-class families in
      // `getConnectorFamily`. The backend `ConnectorDefinition` row does not
      // carry `categories`, so the multi-tag list is read from the bundled
      // builtin definitions via `connectorCategoryTags`. One vocabulary for
      // "this is a database the console can open".
      .filter((c) => {
        const def = connectorByName.get(c.service_type);
        if (!def) return false;
        return def.category === 'database' || connectorCategoryTags(c.service_type).includes('database');
      })
      .map((c) => ({
        credential: c,
        connector: connectorByName.get(c.service_type),
        pinnedTableCount: pinnedTableCountByCredential.get(c.id) || 0,
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
      { value: '', label: tx(db.all_types, { count: types.size }) },
      ...Array.from(types.entries()).sort(([, a], [, b]) => a.localeCompare(b)).map(([val, lab]) => ({ value: val, label: lab })),
    ];
  }, [allRows, db.all_types, tx]);

  const displayRows = useMemo(() => {
    let rows = allRows;
    if (typeFilter) rows = rows.filter((r) => r.credential.service_type === typeFilter);
    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        switch (sortKey) {
          case 'name': return dir * a.credential.name.localeCompare(b.credential.name);
          case 'tables': return dir * (a.pinnedTableCount - b.pinnedTableCount);
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

  // Settled-only: the "no databases" illustration only makes sense once the
  // manager's fetch has actually settled. While isFetching is true, fall
  // through to the DataGrid below with isLoading set, which paints its own
  // delayed calm ghost rows under the real column chrome instead.
  if (allRows.length === 0 && !isFetching) {
    return (
      <div className="animate-fade-slide-in">
        <EmptyIllustration
          icon={Database}
          heading={db.no_credentials}
          description={db.no_credentials_hint}
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
          isLoading={isFetching && displayRows.length === 0}
          emptyIcon={Database}
          emptyTitle={db.no_matching}
          emptyDescription={db.no_matching_hint}
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
