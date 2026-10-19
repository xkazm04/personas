import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const patchCredentialMetadata = vi.fn();
const healthcheckCredential = vi.fn();

vi.mock('@/api/vault/credentials', () => ({
  healthcheckCredential: (...a: unknown[]) => healthcheckCredential(...a),
  healthcheckCredentialPreview: vi.fn(),
  patchCredentialMetadata: (...a: unknown[]) => patchCredentialMetadata(...a),
}));
vi.mock('@/api/overview/healthcheckApi', () => ({
  testCredentialDesignHealthcheck: vi.fn(),
}));
vi.mock('@/lib/utils/platform/crypto', () => ({
  encryptWithSessionKey: vi.fn(async (s: string) => s),
}));

const credential = {
  id: 'cred-1',
  metadata: null,
  healthcheck_last_success: true,
};

vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({ credentials: [credential] }),
    setState: vi.fn(),
  },
}));

import { useCredentialHealth } from '../useCredentialHealth';

function mount() {
  return renderHook(() => useCredentialHealth('cred-1'));
}

describe('useCredentialHealth — a probe verdict survives its bookkeeping', () => {
  beforeEach(() => {
    patchCredentialMetadata.mockReset();
    patchCredentialMetadata.mockResolvedValue({
      id: 'cred-1',
      name: 'c',
      serviceType: 'github',
      metadata: null,
      scopedResources: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    healthcheckCredential.mockReset();
  });

  it('keeps a verified verdict when only the metadata write fails', async () => {
    // The probe answered. Persisting that answer is bookkeeping: a failed
    // patch (DB busy, IPC timeout) used to throw out of the check and repaint
    // a verified credential as `unreachable` / "Healthcheck failed".
    healthcheckCredential.mockResolvedValue({ success: true, message: 'ok', state: 'verified' });
    patchCredentialMetadata.mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    const { result } = mount();

    await act(async () => {
      await result.current.checkStored();
    });

    expect(patchCredentialMetadata).toHaveBeenCalledTimes(1);
    expect(result.current.result?.state).toBe('verified');
    expect(result.current.result?.success).toBe(true);
  });
});
