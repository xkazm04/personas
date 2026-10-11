import { describe, it, expect, vi, beforeEach } from 'vitest';

const cloudStatusMock = vi.fn();
vi.mock('@/api/system/cloud', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  cloudStatus: (...a: unknown[]) => cloudStatusMock(...a),
}));

import { useSystemStore } from '@/stores/systemStore';

describe('cloudFetchStatus', () => {
  beforeEach(() => {
    cloudStatusMock.mockReset();
  });

  it('swallows failures by default (Refresh button) but rethrows for the poller', async () => {
    cloudStatusMock.mockRejectedValue(new Error('down'));
    const { cloudFetchStatus } = useSystemStore.getState();
    await expect(cloudFetchStatus()).resolves.toBeUndefined();
    await expect(cloudFetchStatus({ rethrow: true })).rejects.toThrow('down');
    expect(useSystemStore.getState().cloudIsLoadingStatus).toBe(false);
    expect(useSystemStore.getState().cloudError).toBeTruthy();
  });
});
