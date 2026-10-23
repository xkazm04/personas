import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CloudSyncStatus } from '@/lib/bindings/CloudSyncStatus';

const cloudSyncNow = vi.fn<() => Promise<CloudSyncStatus>>();
const addToast = vi.fn();

vi.mock('@/api/cloudSync', () => ({
  getCloudSyncStatus: () => Promise.resolve(status({})),
  setCloudSyncEnabled: vi.fn().mockResolvedValue(undefined),
  cloudSyncNow: () => cloudSyncNow(),
}));
vi.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock('../PairedPhonesPanel', () => ({ default: () => null }));
vi.mock('../DeviceNameField', () => ({ default: () => null }));
vi.mock('../SyncedDataToggles', () => ({ default: () => null }));

import CloudSyncCard from '../CloudSyncCard';

function status(over: Partial<CloudSyncStatus>): CloudSyncStatus {
  return {
    enabled: true,
    syncing: false,
    deviceId: 'dev-1',
    deviceName: null,
    lastSyncAt: null,
    lastError: null,
    rowsSyncedLast: 0n,
    totalRowsSynced: 0n,
    tables: [],
    syncNotes: false,
    syncChats: false,
    ...over,
  };
}

beforeEach(() => {
  cloudSyncNow.mockReset();
  addToast.mockReset();
});

async function pressSyncNow() {
  render(<CloudSyncCard />);
  fireEvent.click(await screen.findByRole('button', { name: /sync now/i }));
  await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
  return addToast.mock.calls[0];
}

describe('CloudSyncCard: Sync now', () => {
  it('does not report success for a pass that failed', async () => {
    cloudSyncNow.mockResolvedValue(status({ lastError: 'synced_events: 401 Unauthorized', rowsSyncedLast: 0n }));
    const [, type] = await pressSyncNow();
    expect(type).toBe('warning');
  });

  it('reports the synced count for a clean pass', async () => {
    cloudSyncNow.mockResolvedValue(status({ rowsSyncedLast: 12n }));
    const [message, type] = await pressSyncNow();
    expect(type).toBe('success');
    expect(message).toContain('12');
  });
});
