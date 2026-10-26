// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the discovery API module so we can drive success/failure per call.
vi.mock("@/api/network/discovery", () => ({
  getDiscoveredPeers: vi.fn(),
  getNetworkStatus: vi.fn(),
  getNetworkSnapshot: vi.fn(),
  connectToPeer: vi.fn(),
  disconnectPeer: vi.fn(),
  getPeerManifest: vi.fn(),
  syncPeerManifest: vi.fn(),
}));

// Every other network API module reaches the backend through this door, so
// one mock rejects identity / exposure / bundle / enclave calls alike.
vi.mock("@/lib/tauriInvoke", () => ({ invokeWithTimeout: vi.fn() }));

// The capability probe is exercised in `src/lib/network/__tests__/p2pCapability.test.ts`.
// Here it is stubbed so these tests stay about the failure counters, and so a
// mocked-rejecting `getNetworkStatus` cannot be misread as "this build has no p2p".
vi.mock("@/lib/network/p2pCapability", () => ({
  probeP2pSupport: vi.fn(() => Promise.resolve(p2pSupported)),
}));

let p2pSupported = true;

import * as discoveryApi from "@/api/network/discovery";
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { storeBus } from "@/lib/storeBus";
import { createNetworkSlice, STALE_THRESHOLD } from "./networkSlice";
import type { SystemStore } from "../../storeTypes";

// Minimal Zustand-style harness: wires set/get around a plain state object so
// we can invoke slice actions without spinning up the full persona store.
function makeHarness() {
  let state = {} as SystemStore;
  const set = (partial: Partial<SystemStore> | ((s: SystemStore) => Partial<SystemStore>)) => {
    const patch = typeof partial === "function" ? (partial as (s: SystemStore) => Partial<SystemStore>)(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createNetworkSlice(set as never, get as never, {} as never);
  state = { ...state, ...slice };
  return { get: () => state };
}

describe("networkSlice STALE_THRESHOLD (per-endpoint)", () => {
  beforeEach(() => {
    p2pSupported = true;
    vi.mocked(discoveryApi.getDiscoveredPeers).mockReset();
    vi.mocked(discoveryApi.getNetworkStatus).mockReset();
    vi.mocked(discoveryApi.getNetworkSnapshot).mockReset();
  });

  it("threshold is 3", () => {
    expect(STALE_THRESHOLD).toBe(3);
  });

  it("does NOT trip the warning on a single failure across each endpoint", async () => {
    // The pre-fix shared counter would have tripped here. Per-endpoint
    // counters require 3 consecutive failures on the SAME endpoint.
    const h = makeHarness();
    vi.mocked(discoveryApi.getDiscoveredPeers).mockRejectedValue(new Error("boom"));
    vi.mocked(discoveryApi.getNetworkStatus).mockRejectedValue(new Error("boom"));
    vi.mocked(discoveryApi.getNetworkSnapshot).mockRejectedValue(new Error("boom"));

    await h.get().fetchNetworkStatus();
    await h.get().fetchDiscoveredPeers();
    await h.get().fetchNetworkSnapshot();

    expect(h.get().networkConsecutiveFailures).toBe(1); // each endpoint = 1
    expect(h.get().networkError).toBeNull();
  });

  it("trips the warning after 3 consecutive snapshot failures", async () => {
    const h = makeHarness();
    vi.mocked(discoveryApi.getNetworkSnapshot).mockRejectedValue(new Error("boom"));

    await h.get().fetchNetworkSnapshot();
    await h.get().fetchNetworkSnapshot();
    expect(h.get().networkError).toBeNull();
    await h.get().fetchNetworkSnapshot();
    expect(h.get().networkConsecutiveFailures).toBe(3);
    expect(h.get().networkError).toBeTruthy();
  });

  it("does NOT silently mask a stale endpoint when a different one succeeds", async () => {
    // The bug: a single success on snapshot reset the shared counter to 0,
    // hiding repeated status-poll failures. Per-endpoint counters fix it.
    const h = makeHarness();
    vi.mocked(discoveryApi.getNetworkStatus).mockRejectedValue(new Error("boom"));
    vi.mocked(discoveryApi.getDiscoveredPeers).mockResolvedValue([]);

    await h.get().fetchNetworkStatus();
    await h.get().fetchNetworkStatus();
    await h.get().fetchNetworkStatus();
    expect(h.get().networkError).toBeTruthy(); // status hit threshold

    // A success on a different poller should NOT clear the warning.
    await h.get().fetchDiscoveredPeers();
    expect(h.get().networkError).toBeTruthy();
    expect(h.get().networkConsecutiveFailures).toBe(3);
  });

  it("only the failing endpoint's counter is reset on its own success", async () => {
    const h = makeHarness();
    vi.mocked(discoveryApi.getNetworkStatus).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(discoveryApi.getNetworkStatus).mockRejectedValueOnce(new Error("boom"));

    await h.get().fetchNetworkStatus();
    await h.get().fetchNetworkStatus();
    expect(h.get().networkConsecutiveFailures).toBe(2);

    // Now status succeeds — its own slot resets to 0.
    vi.mocked(discoveryApi.getNetworkStatus).mockResolvedValueOnce({} as never);
    await h.get().fetchNetworkStatus();
    expect(h.get().networkConsecutiveFailures).toBe(0);
    expect(h.get().networkError).toBeNull();
  });

  it("aggregate networkConsecutiveFailures reflects the worst endpoint", async () => {
    const h = makeHarness();
    vi.mocked(discoveryApi.getDiscoveredPeers).mockRejectedValue(new Error("boom"));
    vi.mocked(discoveryApi.getNetworkStatus).mockRejectedValue(new Error("boom"));

    await h.get().fetchNetworkStatus();
    await h.get().fetchDiscoveredPeers();
    await h.get().fetchDiscoveredPeers();
    expect(h.get().networkConsecutiveFailures).toBe(2); // peers = 2, status = 1
  });
});

describe("networkSlice p2p capability gate", () => {
  beforeEach(() => {
    p2pSupported = true;
    vi.mocked(discoveryApi.getDiscoveredPeers).mockReset();
    vi.mocked(discoveryApi.getNetworkSnapshot).mockReset();
    vi.mocked(discoveryApi.connectToPeer).mockReset();
  });

  it("skips read IPC entirely when the build has no p2p", async () => {
    p2pSupported = false;
    const h = makeHarness();
    vi.mocked(discoveryApi.getDiscoveredPeers).mockResolvedValue([]);

    await h.get().fetchDiscoveredPeers();

    expect(discoveryApi.getDiscoveredPeers).not.toHaveBeenCalled();
    expect(h.get().p2pUnavailable).toBe(true);
    // A skipped read is not a failure: it must not feed the staleness counter.
    expect(h.get().networkConsecutiveFailures).toBe(0);
    expect(h.get().networkError).toBeNull();
  });

  it("rejects MUTATING actions instead of silently no-opping", async () => {
    // The old sniff was consulted by three read paths only, so writes reported
    // success against a backend that never received the call.
    p2pSupported = false;
    const h = makeHarness();

    await expect(h.get().connectToPeer("peer-a")).rejects.toThrow(/p2p/i);
    expect(discoveryApi.connectToPeer).not.toHaveBeenCalled();
  });

  it("does NOT latch on a runtime error once the probe says p2p is present", async () => {
    const h = makeHarness();
    // A structured NotFound whose message contains "not found" is exactly what
    // the old substring sniff mistook for a missing feature.
    vi.mocked(discoveryApi.getDiscoveredPeers).mockRejectedValue({
      error: "peer not found",
      kind: "not_found",
    });

    await h.get().fetchDiscoveredPeers();

    expect(h.get().p2pUnavailable).toBe(false);
    expect(h.get().networkConsecutiveFailures).toBe(1);
  });
});

describe("networkSlice rethrowing actions leave the toast to their caller", () => {
  // Every caller of these actions catches and shows its own translated toast or
  // inline error. A store toast on top of that is a second toast for the same
  // failure, carrying the raw backend text.
  const appError = { error: "backend said no", kind: "internal" };
  const opts = { skip_conflicts: true, rename_prefix: null };
  const policy = {} as never;
  const actions: Array<[string, (s: SystemStore) => Promise<unknown>]> = [
    ["setDisplayName", (s) => s.setDisplayName("x")],
    ["exportIdentityCard", (s) => s.exportIdentityCard()],
    ["importTrustedPeer", (s) => s.importTrustedPeer("card")],
    ["revokePeerTrust", (s) => s.revokePeerTrust("p")],
    ["deleteTrustedPeer", (s) => s.deleteTrustedPeer("p")],
    ["createExposedResource", (s) => s.createExposedResource({} as never)],
    ["deleteExposedResource", (s) => s.deleteExposedResource("r")],
    ["exportBundle", (s) => s.exportBundle(["r"], "/tmp/b.persona")],
    ["exportBundleToClipboard", (s) => s.exportBundleToClipboard(["r"])],
    ["previewBundleImport", (s) => s.previewBundleImport("/tmp/b.persona")],
    ["previewBundleFromClipboard", (s) => s.previewBundleFromClipboard("abc")],
    ["applyBundleImport", (s) => s.applyBundleImport("/tmp/b.persona", opts as never)],
    ["applyBundleFromClipboard", (s) => s.applyBundleFromClipboard("abc", opts as never)],
    ["createShareLink", (s) => s.createShareLink(["r"])],
    ["previewShareLink", (s) => s.previewShareLink("personas://share/x")],
    ["importFromShareLink", (s) => s.importFromShareLink("personas://share/x", opts as never)],
    ["sealEnclave", (s) => s.sealEnclave("p", policy, "/tmp/e.enclave")],
    ["verifyEnclave", (s) => s.verifyEnclave("/tmp/e.enclave")],
    ["connectToPeer", (s) => s.connectToPeer("p")],
    ["disconnectPeer", (s) => s.disconnectPeer("p")],
    ["syncPeerManifest", (s) => s.syncPeerManifest("p")],
  ];

  beforeEach(() => {
    p2pSupported = true;
    vi.mocked(invokeWithTimeout).mockReset().mockRejectedValue(appError);
    vi.mocked(discoveryApi.connectToPeer).mockReset().mockRejectedValue(appError);
    vi.mocked(discoveryApi.disconnectPeer).mockReset().mockRejectedValue(appError);
    vi.mocked(discoveryApi.syncPeerManifest).mockReset().mockRejectedValue(appError);
  });

  it.each(actions)("%s rejects, records the error, and emits no store toast", async (_name, run) => {
    const emit = vi.spyOn(storeBus, "emit");
    const h = makeHarness();

    await expect(run(h.get())).rejects.toBe(appError);
    await vi.dynamicImportSettled();

    expect(emit.mock.calls.filter(([event]) => event === "toast")).toEqual([]);
    // The error is still recorded for any inline reader.
    expect(h.get().error).toBe("backend said no");
    emit.mockRestore();
  });
});
