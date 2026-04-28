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

import * as discoveryApi from "@/api/network/discovery";
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
