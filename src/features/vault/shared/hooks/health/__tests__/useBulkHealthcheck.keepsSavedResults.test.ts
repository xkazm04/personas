import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const healthcheckAllCredentials = vi.fn();
const fetchCredentials = vi.fn();
const setHealthResultStatic = vi.fn();

vi.mock('@/api/vault/credentials', () => ({
  healthcheckAllCredentials: (...a: unknown[]) => healthcheckAllCredentials(...a),
}));
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: { getState: () => ({ fetchCredentials }) },
}));
vi.mock('../useCredentialHealth', () => ({
  setHealthResultStatic: (...a: unknown[]) => setHealthResultStatic(...a),
}));

import { useBulkHealthcheck } from '../useBulkHealthcheck';

const sweep = {
  total: 1,
  passed: 1,
  failed: 0,
  unverifiable: 0,
  completedAt: '2026-11-11T00:00:00Z',
  results: [
    { credentialId: 'cred-1', credentialName: 'GitHub', success: true, message: 'ok', durationMs: 12 },
  ],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useBulkHealthcheck: results the server already saved are kept', () => {
  beforeEach(() => {
    healthcheckAllCredentials.mockReset();
    fetchCredentials.mockReset();
    setHealthResultStatic.mockReset();
  });

  it('refreshes the health and summary caches when the page unmounts mid-sweep', async () => {
    const call = deferred<typeof sweep>();
    healthcheckAllCredentials.mockReturnValue(call.promise);
    const first = renderHook(() => useBulkHealthcheck());
    let running!: Promise<void>;
    act(() => {
      running = first.result.current.run([]);
    });
    first.unmount();
    await act(async () => {
      call.resolve(sweep);
      await running;
    });

    expect(setHealthResultStatic).toHaveBeenCalledWith('cred-1', { success: true, message: 'ok' });
    expect(fetchCredentials).toHaveBeenCalledTimes(1);
    // A fresh mount (the user comes back) sees the saved summary.
    const second = renderHook(() => useBulkHealthcheck());
    expect(second.result.current.summary?.passed).toBe(1);
    act(() => second.result.current.dismiss());
  });

  it('keeps the results when the user cancels mid-sweep', async () => {
    const call = deferred<typeof sweep>();
    healthcheckAllCredentials.mockReturnValue(call.promise);
    const { result } = renderHook(() => useBulkHealthcheck());
    let running!: Promise<void>;
    act(() => {
      running = result.current.run([]);
    });
    act(() => result.current.cancel());
    expect(result.current.isRunning).toBe(false);
    await act(async () => {
      call.resolve(sweep);
      await running;
    });

    expect(setHealthResultStatic).toHaveBeenCalledTimes(1);
    expect(fetchCredentials).toHaveBeenCalledTimes(1);
    expect(result.current.summary?.total).toBe(1);
    act(() => result.current.dismiss());
  });
});
