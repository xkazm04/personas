import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const introspectColumns = vi.fn();
vi.mock('@/api/vault/database/dbSchema', () => ({
  introspectDbColumns: (credentialId: string, tableName: string) => introspectColumns(credentialId, tableName),
  introspectDbTables: vi.fn(),
}));
vi.mock('@/features/vault/sub_databases/introspectionQueries', () => ({ getConnectorFamily: () => 'postgres' }));

import { clearCacheForCredential, useTableIntrospection } from '../useTableIntrospection';

const columns = { columns: ['column_name', 'data_type'], rows: [['id', 'integer']], truncated: false };

beforeEach(() => {
  clearCacheForCredential('credential-cache-test');
  introspectColumns.mockReset();
});

describe('useTableIntrospection', () => {
  it('clears the old table error when the next table is cached', async () => {
    introspectColumns.mockImplementation((_id: string, table: string) =>
      table === 'cached' ? Promise.resolve(columns) : Promise.reject(new Error('Table A failed')));
    const { result } = renderHook(() => useTableIntrospection({ credentialId: 'credential-cache-test', serviceType: 'postgres', autoFetch: false }));

    await act(async () => result.current.fetchColumns('cached'));
    await act(async () => result.current.fetchColumns('failed'));
    expect(result.current.columnsError).toBe('Table A failed');
    await act(async () => result.current.fetchColumns('cached'));

    expect(result.current.columnsError).toBeNull();
    expect(result.current.columnsLoading).toBe(false);
    expect(result.current.columns[0]?.column_name).toBe('id');
  });

  it('stops the old spinner when switching to cached columns during a request', async () => {
    let finishPending: (value: typeof columns) => void = () => {};
    const pending = new Promise<typeof columns>((resolve) => { finishPending = resolve; });
    introspectColumns.mockImplementation((_id: string, table: string) =>
      table === 'cached' ? Promise.resolve(columns) : pending);
    const { result } = renderHook(() => useTableIntrospection({ credentialId: 'credential-cache-test', serviceType: 'postgres', autoFetch: false }));

    await act(async () => result.current.fetchColumns('cached'));
    act(() => { void result.current.fetchColumns('pending'); });
    expect(result.current.columnsLoading).toBe(true);
    await act(async () => result.current.fetchColumns('cached'));
    expect(result.current.columnsLoading).toBe(false);
    await act(async () => finishPending(columns));
    expect(result.current.columnsLoading).toBe(false);
  });
});
