import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { CloudSyncStatus } from '@/lib/bindings/CloudSyncStatus';

/** Read the current cloud-sync status (enabled flag + last-run telemetry). */
export const getCloudSyncStatus = () =>
  invokeWithTimeout<CloudSyncStatus>('cloud_sync_status');

/** Enable or disable desktop → cloud dashboard sync (persisted; default off). */
export const setCloudSyncEnabled = (enabled: boolean) =>
  invokeWithTimeout<void>('cloud_sync_set_enabled', { enabled });

/** Trigger one sync pass now. Requires a live Google session. Returns the fresh
 *  status after the pass so the UI can render the result in one round-trip. */
export const cloudSyncNow = () => invokeWithTimeout<CloudSyncStatus>('cloud_sync_now');
