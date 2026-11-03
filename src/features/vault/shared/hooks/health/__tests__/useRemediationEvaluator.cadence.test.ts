import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * The evaluator's cadence is "15 s after mount, then every 30 min". It used to
 * close over the `credentials` array, so every store write that produced a new
 * array (a fetch, a metadata patch, a tag edit, a rename) tore the effect down
 * and re-armed the 15 s start timer: the ladder ran 15 s after EACH write
 * instead of every 30 min, and a degraded credential re-notified on the 5 min
 * notify cooldown instead of the designed interval.
 */

const getRotationStatus = vi.fn();
const getAllRotationStatuses = vi.fn();
vi.mock('@/api/vault/rotation', () => ({
  getRotationStatus: (...a: unknown[]) => getRotationStatus(...a),
  getAllRotationStatuses: (...a: unknown[]) => getAllRotationStatuses(...a),
}));
vi.mock('@/lib/credentials/remediationExecutor', () => ({
  executeRemediationAction: vi.fn(async () => undefined),
}));

import { useVaultStore } from '@/stores/vaultStore';
import { useRemediationEvaluator } from '../useRemediationEvaluator';
import type { CredentialMetadata } from '@/lib/types/types';

function actionable(id: string): CredentialMetadata {
  return {
    id,
    name: id,
    service_type: 'github',
    metadata: '{"anomaly_score":{"remediation":"BackoffRetry"}}',
  } as CredentialMetadata;
}

describe('useRemediationEvaluator cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getRotationStatus.mockReset();
    getAllRotationStatuses.mockReset();
    getAllRotationStatuses.mockResolvedValue({});
    useVaultStore.setState({ credentials: [actionable('c1')] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not re-run the ladder when the credentials array changes between ticks', async () => {
    renderHook(() => useRemediationEvaluator());

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(getAllRotationStatuses).toHaveBeenCalledTimes(1);

    // Three unrelated store writes over the next ~20 minutes.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        useVaultStore.setState({ credentials: [actionable('c1')] });
        await vi.advanceTimersByTimeAsync(6 * 60_000);
      });
    }
    expect(getAllRotationStatuses).toHaveBeenCalledTimes(1);

    // The 30-minute tick still fires, and reads the CURRENT credentials.
    useVaultStore.setState({ credentials: [actionable('c1'), actionable('c2')] });
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
    // One batched call per evaluation pass, not one per credential.
    expect(getAllRotationStatuses).toHaveBeenCalledTimes(2);
    expect(getRotationStatus).not.toHaveBeenCalled();
  });
});
