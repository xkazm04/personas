import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * fetchCredentials reports and then RETHROWS. The manager's first-load effect
 * awaited it with no catch, so a failed first fetch skipped
 * setIsFetching(false): an empty credential list stayed on its loading ghost
 * for the whole visit, never reaching the settled empty state.
 */
const vaultState = {
  credentials: [],
  connectorDefinitions: [],
  fetchCredentials: vi.fn(() => Promise.reject({ error: 'database is locked', kind: 'database' })),
  fetchConnectorDefinitions: vi.fn(async () => {}),
  createCredential: vi.fn(),
  deleteCredential: vi.fn(),
  setFocusCredentialId: vi.fn(),
};
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (sel: (s: typeof vaultState) => unknown) => sel(vaultState),
}));
vi.mock('@/stores/systemStore', () => {
  const s = { error: null, setError: () => {} };
  return { useSystemStore: (sel: (x: typeof s) => unknown) => sel(s) };
});
vi.mock('@/features/vault/shared/hooks/useUndoDelete', () => ({
  useUndoDelete: () => ({ requestDelete: vi.fn() }),
}));
vi.mock('@/features/vault/shared/hooks/useCredentialViewFSM', () => ({
  useCredentialViewFSM: () => ({
    state: { view: 'list' }, dispatch: vi.fn(), filteredConnectors: [], catalogFormData: null, breadcrumbs: [],
  }),
}));
vi.mock('@/features/vault/shared/hooks/health/useBulkHealthcheck', () => ({ useBulkHealthcheck: () => ({}) }));
vi.mock('../useRotateAll', () => ({ useRotateAll: () => ({}) }));
vi.mock('../useCatalogHandlers', () => ({ useCatalogHandlers: () => ({}) }));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  silentCatch: () => () => {},
}));

import { useCredentialManagerState } from '../useCredentialManagerState';

describe('useCredentialManagerState first load', () => {
  it('settles isFetching even when the credential fetch rejects', async () => {
    const { result } = renderHook(() => useCredentialManagerState());
    expect(vaultState.fetchCredentials).toHaveBeenCalled();
    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });
});
