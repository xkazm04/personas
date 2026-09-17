import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Could-not-reach is not broken.
 *
 * `check`'s catch used to record `state: 'failed'` for ANY throw, and
 * `checkStored` then persisted `healthcheck_last_success: false` onto the
 * credential regardless of which probe state came back. Between them, one
 * offline moment (airplane mode, a dead VPN, an IPC timeout) marked every
 * stored key broken until each one happened to be probed again -- a verdict
 * about the network written into the credential's health record.
 */

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

describe('useCredentialHealth — could-not-reach is not a verdict', () => {
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

  it('records a thrown IPC/offline error as unreachable, not failed', async () => {
    healthcheckCredential.mockRejectedValue(new Error('error sending request'));
    const { result } = mount();

    await act(async () => {
      await result.current.checkStored();
    });

    expect(result.current.result?.state).toBe('unreachable');
    expect(result.current.result?.success).toBe(false);
    // Nothing was persisted: the probe never produced a verdict.
    expect(patchCredentialMetadata).not.toHaveBeenCalled();
  });

  it('does not persist a boolean failure when the probe could not reach the service', async () => {
    healthcheckCredential.mockResolvedValue({
      success: false,
      message: 'dns failure',
      state: 'unreachable',
    });
    const { result } = mount();

    await act(async () => {
      await result.current.checkStored();
    });

    expect(patchCredentialMetadata).not.toHaveBeenCalled();
    expect(result.current.result?.state).toBe('unreachable');
  });

  it.each([
    ['verified', true],
    ['unverifiable', true],
    ['failed', false],
  ] as const)('persists %s as a typed token alongside the boolean', async (state, success) => {
    healthcheckCredential.mockResolvedValue({ success, message: state, state });
    const { result } = mount();

    await act(async () => {
      await result.current.checkStored();
    });

    expect(patchCredentialMetadata).toHaveBeenCalledTimes(1);
    const patch = patchCredentialMetadata.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.healthcheck_last_state).toBe(state);
    expect(patch.healthcheck_last_success).toBe(success);
  });
});
