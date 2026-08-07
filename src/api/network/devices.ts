/**
 * Device pairing + owned-device registry IPC.
 *
 * Backing Rust: `src-tauri/src/commands/network/pairing.rs` (the ceremony) and
 * `src-tauri/src/commands/network/owned_devices.rs` (the registry). Both are
 * gated behind the `p2p` Cargo feature — every call here must be guarded by
 * `probeP2pSupport()` (see `@/lib/network/p2pCapability`).
 */
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { DevicePairingRequest } from "@/lib/bindings/DevicePairingRequest";
import type { PairingRole } from "@/lib/bindings/PairingRole";
import type { OwnedDevice } from "@/lib/bindings/OwnedDevice";

export type { DevicePairingRequest, PairingRole, OwnedDevice };

// -- Pairing ceremony -------------------------------------------------------

/** Start pairing with a connected peer. Returns the fingerprint to display. */
export const pairRequest = (peerId: string) =>
  invoke<DevicePairingRequest>("pair_request", { peerId });

/** Confirm an inbound pairing. Only valid on the RECEIVING device. */
export const pairConfirm = (peerId: string) =>
  invoke<OwnedDevice>("pair_confirm", { peerId });

/** Abandon a pairing from either side. Idempotent. */
export const pairCancel = (peerId: string) =>
  invoke<void>("pair_cancel", { peerId });

/** Poll-based safety net for a UI that missed `network:device-pairing-requested`. */
export const listPendingDevicePairings = () =>
  invoke<DevicePairingRequest[]>("list_pending_device_pairings");

// -- Owned-device registry --------------------------------------------------

export const listOwnedDevices = () =>
  invoke<OwnedDevice[]>("list_owned_devices");

/**
 * Nominate (or un-nominate) a device as the home machine. The backend clears
 * the flag on every other row in the same transaction, so this is a
 * single-choice operation — never model it as an independent per-device switch.
 */
export const setDeviceHome = (peerId: string, isHome: boolean) =>
  invoke<OwnedDevice>("set_device_home", { peerId, isHome });

export const forgetOwnedDevice = (peerId: string) =>
  invoke<boolean>("forget_owned_device", { peerId });

export const getDeviceGroupId = () =>
  invoke<string>("get_device_group_id");
