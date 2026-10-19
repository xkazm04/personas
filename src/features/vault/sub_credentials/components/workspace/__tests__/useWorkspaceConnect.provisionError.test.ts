import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Workspace provisioning creates each credential through the vault store,
 * which rethrows the IPC AppError object. The per-service error read
 * `err instanceof Error ? err.message : 'Unknown error'`, so every failed
 * service row said "Unknown error".
 */
let onSuccess: ((d: { oauth_session_ref: string; scope: string | null }) => void) | null = null;

vi.mock('@/features/vault/shared/hooks/useGoogleOAuth', () => ({
  useGoogleOAuth: (opts: { onSuccess: typeof onSuccess }) => {
    onSuccess = opts.onSuccess;
    return { startConsent: vi.fn(), reset: vi.fn(), isAuthorizing: false };
  },
}));
vi.mock('@/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker', () => ({
  usePostSaveResourcePicker: () => ({ promptIfScoped: vi.fn(async () => {}), editScope: vi.fn() }),
}));
vi.mock('@/stores/vaultStore', () => {
  const state = {
    createCredential: vi.fn(() => Promise.reject({ error: 'Session ref expired', kind: 'validation' })),
  };
  return { useVaultStore: (sel: (s: typeof state) => unknown) => sel(state) };
});

import { useWorkspaceConnect } from '../useWorkspaceConnect';
import { GOOGLE_WORKSPACE } from '../workspaceProviders';

describe('useWorkspaceConnect provisioning failure', () => {
  it('carries the backend reason on each failed service', async () => {
    const { result } = renderHook(() => useWorkspaceConnect(GOOGLE_WORKSPACE));
    act(() => { result.current.startConnect(); });
    await act(async () => { onSuccess?.({ oauth_session_ref: 'ref-1', scope: null }); });
    await waitFor(() => expect(result.current.phase).toBe('error'));
    const errors = result.current.provisionStates.map((s) => s.error);
    expect(errors.length).toBe(GOOGLE_WORKSPACE.services.length);
    for (const e of errors) expect(e).toBe('Session ref expired');
  });
});
