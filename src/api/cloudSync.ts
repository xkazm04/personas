import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { CloudSyncStatus } from '@/lib/bindings/CloudSyncStatus';
import type { CloudPairingStart } from '@/lib/bindings/CloudPairingStart';
import type { CloudPairingPoll } from '@/lib/bindings/CloudPairingPoll';
import type { CloudController } from '@/lib/bindings/CloudController';
import type { CloudPairingOrigin } from '@/lib/bindings/CloudPairingOrigin';
import type { SyncDataClass } from '@/lib/bindings/SyncDataClass';

/** Read the current cloud-sync status (enabled flag + last-run telemetry). */
export const getCloudSyncStatus = () =>
  invokeWithTimeout<CloudSyncStatus>('cloud_sync_status');

/** Enable or disable desktop → cloud dashboard sync (persisted; default off). */
export const setCloudSyncEnabled = (enabled: boolean) =>
  invokeWithTimeout<void>('cloud_sync_set_enabled', { enabled });

/** Trigger one sync pass now. Requires a live Google session. Returns the fresh
 *  status after the pass so the UI can render the result in one round-trip. */
export const cloudSyncNow = () => invokeWithTimeout<CloudSyncStatus>('cloud_sync_now');

/** Name this desktop in the cloud heartbeat (what the phone shows); null clears
 *  it back to the operating system's name. Returns the fresh status. */
export const setCloudSyncDeviceName = (name: string | null) =>
  invokeWithTimeout<CloudSyncStatus>('cloud_sync_set_device_name', { name });

/** Turn a per-class opt-in on or off ("Sync notes" / "Sync chats"; both default
 *  off). Off deletes this computer's synced rows of that class at the next pass.
 *  Returns the fresh status. */
export const setCloudSyncDataClass = (dataClass: SyncDataClass, enabled: boolean) =>
  invokeWithTimeout<CloudSyncStatus>('cloud_sync_set_data_class', { class: dataClass, enabled });

// -- Paired phones (mobile command plane) ------------------------------------


/** Start pairing a phone: returns the QR (the secret lives only in its URL fragment). */
export const startControllerPairing = () =>
  invokeWithTimeout<CloudPairingStart>('cloud_pair_controller_start');

/** One step of the pairing ceremony. Call every 2 s while the QR is shown. */
export const pollControllerPairing = (pairingId: string) =>
  invokeWithTimeout<CloudPairingPoll>('cloud_pair_controller_poll', { pairingId });

/** Forget a pairing's secret (the QR was closed before a phone paired). */
export const cancelControllerPairing = (pairingId: string) =>
  invokeWithTimeout<void>('cloud_pair_controller_cancel', { pairingId });

/** The paired phones, active first. */
export const listCloudControllers = () =>
  invokeWithTimeout<CloudController[]>('cloud_controllers_list');

/** Revoke one phone, or every phone when `controllerId` is null. */
export const revokeCloudController = (controllerId: string | null) =>
  invokeWithTimeout<number>('cloud_controller_revoke', { controllerId });

/** Where the pairing QR opens (the operator's origin, or the default). */
export const getCloudPairingOrigin = () =>
  invokeWithTimeout<CloudPairingOrigin>('cloud_pairing_origin_get');

/** Set the origin the pairing QR opens (`https://host[:port]`), or clear it with
 *  null. The backend refuses anything but a bare origin. Returns the effective one. */
export const setCloudPairingOrigin = (origin: string | null) =>
  invokeWithTimeout<CloudPairingOrigin>('cloud_pairing_origin_set', { origin });
