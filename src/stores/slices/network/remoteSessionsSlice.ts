/**
 * Remote sessions: fleet sessions THIS device sent to one of the operator's
 * paired devices, plus the devices it can send them to.
 *
 * Thin like its siblings (`devicesSlice`, `remoteJobsSlice`): how a pushed view
 * merges, and what state a view renders as, live in the pure module
 * `@/lib/network/remoteSessionModel`, testable without a store.
 *
 * FRESHNESS. `network:remote-session-updated` pushes one whole view at a time
 * (merged by `applyRemoteSessionUpdate`); `loadRemoteSessions` is the
 * reconcile, run by the surfaces that render remote work on mount, on window
 * focus and on the shared 30 s dashboard cadence - never a faster loop. The
 * device list is also refreshed on `network:snapshot-updated`, coalesced to one
 * read per {@link DEVICES_MIN_INTERVAL_MS}, and only once something has asked
 * for it (a cold slice stays cold).
 *
 * THE P2P GATE. Every action awaits `ensureP2pSupport()` first, reads AND
 * writes. A build without p2p leaves this slice empty and polls nothing; a
 * write rejects with `P2pUnavailableError` so a caller's `await` can never
 * report success for work that never left the machine.
 *
 * `remoteSessionsPinned` is the dev fixture's latch (see
 * `remoteSessionsFixture.ts`): while it is set, loads are skipped so a seeded
 * board survives the reconcile. Nothing in a production path sets it.
 */
import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import * as remoteSessionsApi from "@/api/network/remoteSessions";
import type { DispatchDevice } from "@/lib/bindings/DispatchDevice";
import type { FleetSessionJobPayload } from "@/lib/bindings/FleetSessionJobPayload";
import type { RemoteJob } from "@/lib/bindings/RemoteJob";
import type { RemoteSessionCommand } from "@/lib/bindings/RemoteSessionCommand";
import type { RemoteSessionView } from "@/lib/bindings/RemoteSessionView";
import {
  replaceRemoteSessionViews,
  upsertRemoteSessionView,
} from "@/lib/network/remoteSessionModel";
import { silentCatch } from "@/lib/silentCatch";
import { P2pUnavailableError } from "./networkSlice";

/** Floor between two event-driven device reads (snapshot pushes arrive in bursts). */
export const DEVICES_MIN_INTERVAL_MS = 5_000;

/** Stable empty list, so an unloaded slice never hands out a fresh array. */
const NO_DEVICES: DispatchDevice[] = [];

let lastDevicesReadAt = 0;

export interface RemoteSessionsSlice {
  /** Remote sessions this device dispatched, keyed by job id. */
  remoteSessions: Record<string, RemoteSessionView>;
  /** Paired devices as dispatch targets (never this one). */
  dispatchDevices: DispatchDevice[];
  /** True once a load has settled at least once - the slice is "wanted". */
  remoteSessionsSynced: boolean;
  /** Dev-fixture latch: loads are skipped while it is set. */
  remoteSessionsPinned: boolean;

  /** Reconcile both lists from the backend. */
  loadRemoteSessions: () => Promise<void>;
  /**
   * Re-read the device list. `coalesce` skips the read when one landed within
   * {@link DEVICES_MIN_INTERVAL_MS}, and when nothing has loaded the slice yet.
   */
  refreshDispatchDevices: (opts?: { coalesce?: boolean }) => Promise<void>;
  /** Merge one pushed view (from `network:remote-session-updated`). */
  applyRemoteSessionUpdate: (view: RemoteSessionView) => void;
  /**
   * Send one fleet session to a paired device. Resolves with the persisted job
   * (`queued` when the device is offline, `refused` with the peer's reason);
   * rejects with the backend's typed error.
   */
  dispatchRemoteSession: (peerId: string, payload: FleetSessionJobPayload) => Promise<RemoteJob>;
  /** Steer a running remote session. Rejects when the peer refused or is unreachable. */
  sendRemoteSessionCommand: (jobId: string, command: RemoteSessionCommand, text?: string | null) => Promise<void>;
  /** Start or stop the lossy output tail. Stopping never cancels the session. */
  setRemoteOutputSubscribed: (jobId: string, subscribe: boolean) => Promise<void>;
}

export const createRemoteSessionsSlice: StateCreator<SystemStore, [], [], RemoteSessionsSlice> = (
  set,
  get,
) => ({
  remoteSessions: {},
  dispatchDevices: NO_DEVICES,
  remoteSessionsSynced: false,
  remoteSessionsPinned: false,

  loadRemoteSessions: async () => {
    if (get().remoteSessionsPinned) return;
    if (!(await get().ensureP2pSupport())) return;
    try {
      const [views, devices] = await Promise.all([
        remoteSessionsApi.listRemoteSessions(),
        remoteSessionsApi.listDispatchDevices(),
      ]);
      lastDevicesReadAt = Date.now();
      set((s) => ({
        remoteSessions: replaceRemoteSessionViews(s.remoteSessions, views),
        dispatchDevices: devices.length > 0 ? devices : NO_DEVICES,
        remoteSessionsSynced: true,
      }));
    } catch (err) {
      silentCatch("remoteSessions:load")(err);
      set({ remoteSessionsSynced: true });
    }
  },

  refreshDispatchDevices: async (opts) => {
    const s = get();
    if (s.remoteSessionsPinned) return;
    if (opts?.coalesce) {
      if (!s.remoteSessionsSynced) return;
      if (Date.now() - lastDevicesReadAt < DEVICES_MIN_INTERVAL_MS) return;
    }
    if (!(await get().ensureP2pSupport())) return;
    lastDevicesReadAt = Date.now();
    try {
      const devices = await remoteSessionsApi.listDispatchDevices();
      set({ dispatchDevices: devices.length > 0 ? devices : NO_DEVICES });
    } catch (err) {
      silentCatch("remoteSessions:devices")(err);
    }
  },

  applyRemoteSessionUpdate: (view) => {
    set((s) => {
      const next = upsertRemoteSessionView(s.remoteSessions, view);
      return next === s.remoteSessions ? {} : { remoteSessions: next };
    });
  },

  dispatchRemoteSession: async (peerId, payload) => {
    if (!(await get().ensureP2pSupport())) throw new P2pUnavailableError();
    const job = await remoteSessionsApi.dispatchRemoteFleetSession(peerId, payload);
    // The Devices history shows it at once; the view arrives by event, and the
    // reconcile below catches a view the event beat us to.
    get().applyRemoteJobUpdate(job);
    void get().loadRemoteSessions();
    return job;
  },

  sendRemoteSessionCommand: async (jobId, command, text = null) => {
    if (!(await get().ensureP2pSupport())) throw new P2pUnavailableError();
    await remoteSessionsApi.remoteSessionCommand(jobId, command, text);
  },

  setRemoteOutputSubscribed: async (jobId, subscribe) => {
    if (!(await get().ensureP2pSupport())) return;
    await remoteSessionsApi.remoteSessionSubscribeOutput(jobId, subscribe);
  },
});

/**
 * Whether a "Run on" picker has anything to offer: p2p is in this build and at
 * least one paired device exists. The fixture latch stands in for the probe so
 * a seeded board renders in a lite build.
 */
export function selectRemoteDispatchAvailable(s: Pick<
  SystemStore,
  "dispatchDevices" | "p2pUnavailable" | "remoteSessionsPinned"
>): boolean {
  return s.dispatchDevices.length > 0 && (!s.p2pUnavailable || s.remoteSessionsPinned);
}

/** Test-only: forget the device-read coalescing stamp. */
export function resetRemoteSessionsSliceForTests(): void {
  lastDevicesReadAt = 0;
}
