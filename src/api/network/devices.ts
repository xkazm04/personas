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

export type { DevicePairingRequest, PairingRole };

/**
 * A peer registered as one of the user's own devices.
 *
 * NOTE (still blocked on a cargo run): the committed ts-rs binding
 * `src/lib/bindings/OwnedDevice.ts` is STALE — it predates the pairing work and
 * is missing `isHome`, `pairedAt` and `publicKey`, all three of which the Rust
 * struct declares today (`src-tauri/core/src/models/owned_device.rs`) and the
 * repo selects and maps
 * (`src-tauri/db/src/repos/resources/owned_devices.rs::map_owned_device`).
 * Refreshing it requires `cargo test --manifest-path src-tauri/Cargo.toml
 * export_bindings`, which this frontend package deliberately does not run, and
 * no fresher copy exists anywhere in the tree (the stray generated `bindings/`
 * dir at the repo root carries the same pre-pairing shape). So the accurate
 * shape stays declared here. Delete this type and switch every importer to
 * `@/lib/bindings/OwnedDevice` in the same change that re-runs export_bindings.
 */
export interface OwnedDevice {
  /** The peer's stable identity (base58 peer_id), matching `discovered_peers`. */
  peerId: string;
  /** Shared anchor marking this peer as belonging to the same user as us. */
  deviceGroupId: string;
  displayName: string;
  addedAt: string;
  lastSyncedAt: string | null;
  /** Exactly one owned device may be home — enforced by a partial unique index. */
  isHome: boolean;
  /** Set when the device completed the signed pairing ceremony. */
  pairedAt: string | null;
  /** The peer's Ed25519 public key as proven during the handshake. */
  publicKey: string | null;
}

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
