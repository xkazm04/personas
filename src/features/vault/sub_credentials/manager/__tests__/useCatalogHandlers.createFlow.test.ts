import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * A catalog Save creates the credential first, then refreshes the list and
 * offers the scope picker. The refresh and the prompt used to share the
 * create's try block, so a failed refresh painted "Failed to create
 * credential" over a credential that already existed and kept the form open;
 * pressing Save again created a duplicate.
 */

const promptIfScoped = vi.fn<(args: { credentialId: string; serviceType: string }) => Promise<void>>();

vi.mock('@/features/vault/shared/hooks/useCredentialOAuth', () => ({
  useCredentialOAuth: () => ({ reset: vi.fn(), startConsent: vi.fn() }),
}));
vi.mock('@/hooks/design/oauth/useUniversalOAuth', () => ({
  useUniversalOAuth: () => ({ reset: vi.fn(), startConsent: vi.fn(), getValues: () => ({}), completedAt: null, valuesVersion: 0 }),
}));
vi.mock('@/features/vault/shared/hooks/health/useCredentialHealth', () => ({
  useCredentialHealth: () => ({ checkPreview: vi.fn(), invalidate: vi.fn(), result: null, isHealthchecking: false }),
}));
vi.mock('@/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker', () => ({
  usePostSaveResourcePicker: () => ({ promptIfScoped, editScope: vi.fn() }),
}));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  silentCatch: () => () => {},
}));

import { useCatalogHandlers } from '../useCatalogHandlers';
import type { ConnectorDefinition } from '@/lib/types/types';

const connector = { name: 'github', label: 'GitHub' } as ConnectorDefinition;

function setup(overrides: {
  createCredential?: () => Promise<string>;
  fetchCredentials?: () => Promise<void>;
}) {
  const dispatch = vi.fn();
  const setError = vi.fn();
  const createCredential = vi.fn(overrides.createCredential ?? (async () => 'cred-1'));
  const fetchCredentials = vi.fn(overrides.fetchCredentials ?? (async () => {}));
  const { result } = renderHook(() =>
    useCatalogHandlers({
      viewState: { view: 'catalog-form', connector, credentialName: 'Mine', oauthValues: {} } as never,
      dispatch,
      catalogFormData: { connector, credentialName: 'Mine', fields: [], isGoogle: false },
      credentialSearch: '',
      setCredentialSearch: vi.fn(),
      setError,
      createCredential,
      fetchCredentials,
    }),
  );
  return { result, dispatch, setError, createCredential };
}

describe('useCatalogHandlers.handleCreateCredential', () => {
  beforeEach(() => {
    promptIfScoped.mockReset();
    promptIfScoped.mockResolvedValue(undefined);
  });

  it('a failed list refresh after a successful create still leaves the form', async () => {
    const { result, dispatch, setError, createCredential } = setup({
      fetchCredentials: async () => { throw { error: 'database is locked', kind: 'database' }; },
    });
    await act(async () => { await result.current.handleCreateCredential({ token: 'x' }); });
    expect(createCredential).toHaveBeenCalledTimes(1);
    expect(setError).not.toHaveBeenCalledWith('Failed to create credential');
    expect(dispatch).toHaveBeenCalledWith({ type: 'GO_LIST' });
  });

  it('a failed scope prompt after a successful create still leaves the form', async () => {
    promptIfScoped.mockRejectedValue(new Error('picker gone'));
    const { result, dispatch, setError } = setup({});
    await act(async () => { await result.current.handleCreateCredential({ token: 'x' }); });
    expect(setError).not.toHaveBeenCalledWith('Failed to create credential');
    expect(dispatch).toHaveBeenCalledWith({ type: 'GO_LIST' });
  });

  it('a failed create keeps the form open and reports it', async () => {
    const { result, dispatch, setError } = setup({
      createCredential: async () => { throw { error: 'name taken', kind: 'validation' }; },
    });
    await act(async () => { await result.current.handleCreateCredential({ token: 'x' }); });
    expect(setError).toHaveBeenCalledWith('Failed to create credential');
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'GO_LIST' });
    expect(promptIfScoped).not.toHaveBeenCalled();
  });
});
