import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * IPC round-trip shape of one evaluation: k non-healthy credentials must cost
 * ONE rotation-status round trip (the batched command), not k sequential ones.
 */

const getRotationStatus = vi.fn();
const getAllRotationStatuses = vi.fn();
vi.mock('@/api/vault/rotation', () => ({
  getRotationStatus: (...a: unknown[]) => getRotationStatus(...a),
  getAllRotationStatuses: (...a: unknown[]) => getAllRotationStatuses(...a),
}));
const execute = vi.fn(async () => undefined);
vi.mock('@/lib/credentials/remediationExecutor', () => ({
  executeRemediationAction: (...a: unknown[]) => execute(...a),
}));

import { remediationBus } from '@/lib/credentials/remediationBus';
import { useVaultStore } from '@/stores/vaultStore';
import { useRemediationEvaluator } from '../useRemediationEvaluator';
import type { CredentialMetadata } from '@/lib/types/types';

function cred(id: string, remediation?: string): CredentialMetadata {
  return {
    id,
    name: id,
    service_type: 'github',
    metadata: remediation ? JSON.stringify({ anomaly_score: { remediation } }) : null,
  } as CredentialMetadata;
}

const status = (remediation: string) => ({
  anomaly_score: { remediation },
});

const rotationCalls = () => getRotationStatus.mock.calls.length + getAllRotationStatuses.mock.calls.length;

describe('useRemediationEvaluator IPC round trips', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getRotationStatus.mockReset();
    getAllRotationStatuses.mockReset();
    execute.mockClear();
    remediationBus.resetCooldowns();
    getRotationStatus.mockImplementation(async () => status('BackoffRetry'));
    getAllRotationStatuses.mockImplementation(async () => ({
      c1: status('BackoffRetry'),
      c2: status('BackoffRetry'),
      c3: status('BackoffRetry'),
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('costs one round trip for three degraded credentials', async () => {
    useVaultStore.setState({ credentials: [cred('c1', 'BackoffRetry'), cred('c2', 'BackoffRetry'), cred('c3', 'BackoffRetry'), cred('ok', 'Healthy')] });
    const { result } = renderHook(() => useRemediationEvaluator());
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(rotationCalls()).toBe(1);
    expect(result.current.lastEvaluation.map((r) => r.credentialId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('makes no rotation call when nothing is a candidate', async () => {
    useVaultStore.setState({ credentials: [cred('ok', 'Healthy'), cred('none')] });
    renderHook(() => useRemediationEvaluator());
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(rotationCalls()).toBe(0);
  });

  it('skips a credential the batch omits (same as a failed per-credential fetch)', async () => {
    useVaultStore.setState({ credentials: [cred('c1', 'BackoffRetry'), cred('c2', 'BackoffRetry')] });
    getAllRotationStatuses.mockResolvedValueOnce({ c1: status('BackoffRetry') });
    const { result } = renderHook(() => useRemediationEvaluator());
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.lastEvaluation.map((r) => r.credentialId)).toEqual(['c1']);
  });
});
