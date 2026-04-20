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

describe("networkSlice STALE_THRESHOLD", () => {
  beforeEach(() => {
    vi.mocked(discoveryApi.getDiscoveredPeers).mockReset();
    vi.mocked(discoveryApi.getNetworkStatus).mockReset();
    vi.mocked(discoveryApi.getNetworkSnapshot).mockReset();
  });

  it("is a shared counter across all three pollers", () => {
    expect(STALE_THRESHOLD).toBe(3);
  });

  it("trips the warning after 3 mixed failures (status + peers + snapshot)", async () => {
    const h = makeHarness();
    vi.mocked(discoveryApi.getDiscoveredPeers).mockRejectedValue(new Error("boom"));
    vi.mocked(discoveryApi.getNetworkStatus).mockRejectedValue(new Error("boom"));
    vi.mocked(discoveryApi.getNetworkSnapshot).mockRejectedValue(new Error("boom"));

    await h.get().fetchNetworkStatus();
    expect(h.get().networkError).toBeNull();
    expect(h.get().networkConsecutiveFailures).toBe(1);

    await h.get().fetchDiscoveredPeers();
    expect(h.get().networkError).toBeNull();
    expect(h.get().networkConsecutiveFailures).toBe(2);

    await h.get().fetchNetworkSnapshot();
    expect(h.get().networkConsecutiveFailures).toBe(3);
    expect(h.get().networkError).toBeTruthy();
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

  it("resets the counter on any successful poll from any endpoint", async () => {
    const h = makeHarness();
    vi.mocked(discoveryApi.getNetworkStatus).mockRejectedValue(new Error("boom"));
    vi.mocked(discoveryApi.getDiscoveredPeers).mockResolvedValue([]);

    await h.get().fetchNetworkStatus();
    await h.get().fetchNetworkStatus();
    expect(h.get().networkConsecutiveFailures).toBe(2);

    // A success on a *different* poller resets the shared counter.
    await h.get().fetchDiscoveredPeers();
    expect(h.get().networkConsecutiveFailures).toBe(0);
    expect(h.get().networkError).toBeNull();
  });
});
