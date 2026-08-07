/**
 * Owned devices + in-flight device pairings.
 *
 * This slice is deliberately thin: it is the TRANSPORT for the pairing surface
 * (IPC calls + the pushed pending list), while the ceremony's own logic lives in
 * the pure reducer at `features/settings/sub_devices/lib/pairingMachine.ts`.
 * Keeping them apart is what lets the state machine be unit-tested without a
 * store, a backend, or React.
 *
 * Every action awaits `ensureP2pSupport()` first — reads AND writes. The old
 * "sniff the error string" heuristic it replaces only ever covered reads.
 */
import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import * as devicesApi from "@/api/network/devices";
import type { DevicePairingRequest, OwnedDevice } from "@/api/network/devices";
import { P2pUnavailableError } from "./networkSlice";

export interface DevicesSlice {
  /** The user's paired devices, most recently added first. */
  ownedDevices: OwnedDevice[];
  /** True while the first owned-device fetch is in flight. */
  ownedDevicesLoading: boolean;
  /** Local device-group anchor, or null before it is resolved. */
  deviceGroupId: string | null;
  /**
   * Pairings awaiting a decision on this device, pushed by the
   * `network:device-pairing-requested` event and refreshed by the poll
   * recovery path. Both carry the identical payload.
   */
  pendingDevicePairings: DevicePairingRequest[];
  /** True once a pending list has landed at least once (event or poll). */
  pendingDevicePairingsSynced: boolean;

  fetchOwnedDevices: () => Promise<void>;
  fetchDeviceGroupId: () => Promise<void>;
  fetchPendingDevicePairings: () => Promise<void>;
  /**
   * Promote a device to home. Exactly ONE device is home globally — the
   * backend demotes the previous one in the same transaction — so callers must
   * present this as a single choice, never as an independent per-device switch.
   */
  setDeviceHome: (peerId: string, isHome: boolean) => Promise<void>;
  forgetOwnedDevice: (peerId: string) => Promise<void>;
}

export const createDevicesSlice: StateCreator<SystemStore, [], [], DevicesSlice> = (set, get) => ({
  ownedDevices: [],
  ownedDevicesLoading: false,
  deviceGroupId: null,
  pendingDevicePairings: [],
  pendingDevicePairingsSynced: false,

  fetchOwnedDevices: async () => {
    if (!(await get().ensureP2pSupport())) return;
    set({ ownedDevicesLoading: true });
    try {
      const devices = await devicesApi.listOwnedDevices();
      set({ ownedDevices: devices, ownedDevicesLoading: false });
    } catch (err) {
      reportError(err, "Failed to load paired devices", set, {
        severity: "state",
        stateUpdates: { ownedDevicesLoading: false },
      });
    }
  },

  fetchDeviceGroupId: async () => {
    if (!(await get().ensureP2pSupport())) return;
    try {
      set({ deviceGroupId: await devicesApi.getDeviceGroupId() });
    } catch (err) {
      reportError(err, "Failed to resolve device group", set, { severity: "state" });
    }
  },

  fetchPendingDevicePairings: async () => {
    if (!(await get().ensureP2pSupport())) return;
    try {
      const pending = await devicesApi.listPendingDevicePairings();
      set({ pendingDevicePairings: pending, pendingDevicePairingsSynced: true });
    } catch (err) {
      reportError(err, "Failed to load pending pairings", set, { severity: "state" });
    }
  },

  setDeviceHome: async (peerId: string, isHome: boolean) => {
    if (!(await get().ensureP2pSupport())) throw new P2pUnavailableError();
    await devicesApi.setDeviceHome(peerId, isHome);
    // Re-read rather than patching locally: promoting one device demotes
    // another in the same transaction, so a local patch would show two homes.
    await get().fetchOwnedDevices();
  },

  forgetOwnedDevice: async (peerId: string) => {
    if (!(await get().ensureP2pSupport())) throw new P2pUnavailableError();
    await devicesApi.forgetOwnedDevice(peerId);
    set((s) => ({ ownedDevices: s.ownedDevices.filter((d) => d.peerId !== peerId) }));
  },
});
