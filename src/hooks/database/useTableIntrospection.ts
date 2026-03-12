import { useState, useEffect, useCallback } from 'react';
import { introspectDbTables, introspectDbColumns } from '@/api/vault/database/dbSchema';
import { getConnectorFamily } from '@/features/vault/sub_databases/introspectionQueries';
import { errMsg } from '@/stores/storeTypes';
import type { QueryResult } from '@/api/vault/database/dbSchema';

// -- Types --------------------------------------------------------------

export interface IntrospectedTable {
  table_name: string;
  table_type: string;
}

export interface IntrospectedColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface RedisKeyInfo {
  key: string;
  type?: string;
}

// -- Module-level cache -------------------------------------------------
// Persists across tab switches and component remounts within the session.
// Cleared explicitly via refresh/clearCache.
// Bounded to prevent unbounded memory growth in long sessions.
const MAX_TABLE_CACHE = 50;
const MAX_COLUMN_CACHE = 200;

const _tableCache = new Map<string, IntrospectedTable[]>();
const _redisKeyCache = new Map<string, RedisKeyInfo[]>();
const _columnCache = new Map<string, IntrospectedColumn[]>();

/** Evict oldest entries when a Map exceeds maxSize. */
function boundedSet<V>(map: Map<string, V>, key: string, value: V, maxSize: number) {
  map.set(key, value);
  if (map.size > maxSize) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export function clearCacheForCredential(credentialId: string) {
  _tableCache.delete(credentialId);
  _redisKeyCache.delete(credentialId);
  for (const key of _columnCache.keys()) {
    if (key.startsWith(`${credentialId}:`)) _columnCache.delete(key);
  }
}

/** Read column cache for a given table (used by TablesTab for pin hints). */
export function getCachedColumns(credentialId: string, tableName: string): IntrospectedColumn[] | undefined {
  return _columnCache.get(`${credentialId}:${tableName}`);
}

// -- Parsers ------------------------------------------------------------

export function parseTablesResult(result: QueryResult): IntrospectedTable[] {
  const nameIdx = result.columns.indexOf('table_name');
  const typeIdx = result.columns.indexOf('table_type');
  if (nameIdx === -1) return [];
  return result.rows.map((row) => ({
    table_name: String(row[nameIdx] ?? ''),
    table_type: String(row[typeIdx] ?? 'BASE TABLE'),
  }));
}

export function parseColumnsResult(result: QueryResult): IntrospectedColumn[] {
  const nameIdx = result.columns.indexOf('column_name');
  const typeIdx = result.columns.findIndex((c) => c === 'data_type' || c === 'column_type');
  const nullableIdx = result.columns.indexOf('is_nullable');
  const defaultIdx = result.columns.indexOf('column_default');
  if (nameIdx === -1) return [];
  return result.rows.map((row) => ({
    column_name: String(row[nameIdx] ?? ''),
    data_type: String(row[typeIdx] ?? 'unknown'),
    is_nullable: String(row[nullableIdx] ?? 'YES'),
    column_default: row[defaultIdx] != null ? String(row[defaultIdx]) : null,
  }));
}

export function parseRedisKeysResult(result: QueryResult): string[] {
  if (result.rows.length === 0) return [];

  const keys: string[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i]!;
    const val = row[0];
    if (val === null || val === undefined) continue;

    // SCAN cursor is usually the first scalar item; skip that token.
    if (i === 0 && !Array.isArray(val) && /^\d+$/.test(String(val))) {
      continue;
    }

    if (Array.isArray(val)) {
      for (const k of val) {
        const next = String(k).trim();
        if (next) keys.push(next);
      }
    } else {
      const next = String(val).trim();
      if (next) keys.push(next);
    }
  }
  return keys;
}

// -- Hook ---------------------------------------------------------------

interface UseTableIntrospectionOptions {
  credentialId: string;
  serviceType: string;
  autoFetch?: boolean;
}

interface UseTableIntrospectionReturn {
  tables: IntrospectedTable[];
  redisKeys: RedisKeyInfo[];
  loading: boolean;
  error: string | null;
  isRedis: boolean;
  family: ReturnType<typeof getConnectorFamily>;
  fetchTables: (skipCache?: boolean) => Promise<void>;
  fetchColumns: (tableName: string) => Promise<void>;
  columns: IntrospectedColumn[];
  columnsLoading: boolean;
  columnsError: string | null;
  clearCache: () => void;
}

export function useTableIntrospection({
  credentialId,
  serviceType,
  autoFetch = true,
}: UseTableIntrospectionOptions): UseTableIntrospectionReturn {
  const family = getConnectorFamily(serviceType);
  const isRedis = family === 'redis';

  const [tables, setTables] = useState<IntrospectedTable[]>(() => _tableCache.get(credentialId) ?? []);
  const [redisKeys, setRedisKeys] = useState<RedisKeyInfo[]>(() => _redisKeyCache.get(credentialId) ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [columns, setColumns] = useState<IntrospectedColumn[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [columnsError, setColumnsError] = useState<string | null>(null);

  const fetchTables = useCallback(async (skipCache = false) => {
    if (!skipCache) {
      if (isRedis && _redisKeyCache.has(credentialId)) {
        setRedisKeys(_redisKeyCache.get(credentialId)!);
        return;
      }
      if (!isRedis && _tableCache.has(credentialId)) {
        setTables(_tableCache.get(credentialId)!);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const result = await introspectDbTables(credentialId);
      if (isRedis) {
        const keys = parseRedisKeysResult(result).map((k) => ({ key: k }));
        boundedSet(_redisKeyCache, credentialId, keys, MAX_TABLE_CACHE);
        setRedisKeys(keys);
      } else {
        const parsed = parseTablesResult(result);
        boundedSet(_tableCache, credentialId, parsed, MAX_TABLE_CACHE);
        setTables(parsed);
      }
    } catch (err) {
      setError(errMsg(err, 'Failed to fetch tables'));
    } finally {
      setLoading(false);
    }
  }, [credentialId, isRedis]);

  const fetchColumns = useCallback(async (tableName: string) => {
    const cacheKey = `${credentialId}:${tableName}`;
    const cached = _columnCache.get(cacheKey);
    if (cached) {
      setColumns(cached);
      return;
    }

    setColumnsLoading(true);
    setColumnsError(null);
    try {
      const result = await introspectDbColumns(credentialId, tableName);
      const parsed = parseColumnsResult(result);
      boundedSet(_columnCache, cacheKey, parsed, MAX_COLUMN_CACHE);
      setColumns(parsed);
    } catch (err) {
      setColumnsError(errMsg(err, 'Failed to fetch columns'));
    } finally {
      setColumnsLoading(false);
    }
  }, [credentialId]);

  const clearCache = useCallback(() => {
    clearCacheForCredential(credentialId);
  }, [credentialId]);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch && family !== 'unsupported') {
      fetchTables();
    }
  }, [autoFetch, family, fetchTables]);

  return {
    tables,
    redisKeys,
    loading,
    error,
    isRedis,
    family,
    fetchTables,
    fetchColumns,
    columns,
    columnsLoading,
    columnsError,
    clearCache,
  };
}
