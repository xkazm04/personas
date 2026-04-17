import { useState, useCallback } from 'react';
import { useVaultStore } from "@/stores/vaultStore";
import { useTranslation } from '@/i18n/useTranslation';
import { getSelectAllQuery, isApiFamily } from '../introspectionQueries';
import { TableContextMenu, type TableContextMenuState } from './TableContextMenu';
import { useTableIntrospection, getCachedColumns } from '@/hooks/database/useTableIntrospection';
import { TableListSidebar } from './TableListSidebar';
import { TableDetailPanel } from './TableDetailPanel';
import { TestConnectionButton } from './TableActions';

interface TablesTabProps {
  credentialId: string;
  serviceType: string;
}

export function TablesTab({ credentialId, serviceType }: TablesTabProps) {
  const executeDbQuery = useVaultStore((s) => s.executeDbQuery);
  const pinnedTables = useVaultStore((s) => s.dbSchemaTables).filter((t) => t.credential_id === credentialId);
  const createTable = useVaultStore((s) => s.createDbSchemaTable);

  const {
    tables, redisKeys, loading, error, isRedis, family,
    fetchTables, fetchColumns, columns, columnsLoading, columnsError, clearCache,
  } = useTableIntrospection({ credentialId, serviceType });

  const isApi = isApiFamily(family);

  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyTypeResult, setKeyTypeResult] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<TableContextMenuState | null>(null);
  const [filter, setFilter] = useState('');

  const fetchKeyType = useCallback(async (key: string) => {
    try {
      const result = await executeDbQuery(credentialId, `TYPE ${key}`);
      const val = result.rows[0]?.[0];
      setKeyTypeResult(val != null ? String(val) : 'unknown');
    } catch { setKeyTypeResult('error'); }
  }, [credentialId, executeDbQuery]);

  const handleSelectTable = useCallback((tableName: string) => {
    setSelectedTable(tableName);
    fetchColumns(tableName);
  }, [fetchColumns]);

  const handleSelectKey = useCallback((key: string) => {
    setSelectedKey(key);
    setKeyTypeResult(null);
    fetchKeyType(key);
  }, [fetchKeyType]);

  const handleRefresh = useCallback(() => {
    clearCache();
    setSelectedTable(null);
    setSelectedKey(null);
    setKeyTypeResult(null);
    fetchTables(true);
  }, [clearCache, fetchTables]);

  const handlePinTable = useCallback(async (tableName: string) => {
    const cached = getCachedColumns(credentialId, tableName);
    const hints = cached
      ? JSON.stringify(cached.map((c) => ({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === 'YES', default: c.column_default })))
      : null;
    const alreadyPinned = pinnedTables.some((t) => t.table_name === tableName);
    if (!alreadyPinned) await createTable(credentialId, tableName, null, hints);
  }, [credentialId, pinnedTables, createTable]);

  const handleContextMenu = useCallback((e: React.MouseEvent, tableName: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tableName });
  }, []);

  const handleCopyQuery = useCallback((tableName: string) => {
    navigator.clipboard.writeText(getSelectAllQuery(serviceType, tableName));
  }, [serviceType]);

  const handleCopyName = useCallback((tableName: string) => {
    navigator.clipboard.writeText(tableName);
  }, []);

  const { t } = useTranslation();

  if (family === 'unsupported') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-full min-h-[300px]">
        <p className="text-sm text-foreground">
          {t.vault.databases.introspection_unavailable}
        </p>
        <TestConnectionButton credentialId={credentialId} />
      </div>
    );
  }

  const pinnedTableNames = new Set(pinnedTables.map((p) => p.table_name));

  return (
    <div className="flex h-full min-h-[500px]">
      <TableListSidebar
        tables={tables} redisKeys={redisKeys} loading={loading} error={error}
        isRedis={isRedis} isApi={isApi} filter={filter} onFilterChange={setFilter}
        selectedTable={selectedTable} selectedKey={selectedKey}
        pinnedTableNames={pinnedTableNames}
        onSelectTable={handleSelectTable} onSelectKey={handleSelectKey}
        onRefresh={handleRefresh} onContextMenu={handleContextMenu}
        credentialId={credentialId}
      />
      <TableDetailPanel
        isRedis={isRedis} isApi={isApi}
        selectedTable={selectedTable} selectedKey={selectedKey}
        keyTypeResult={keyTypeResult} tables={tables}
        columns={columns} columnsLoading={columnsLoading} columnsError={columnsError}
        isPinned={selectedTable ? pinnedTableNames.has(selectedTable) : false}
        onPinTable={handlePinTable} family={family}
      />
      {contextMenu && (
        <TableContextMenu
          menu={contextMenu}
          onCopyQuery={handleCopyQuery}
          onCopyName={handleCopyName}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
