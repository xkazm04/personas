import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the API modules the slice imports so we can drive list/delete per call.
// Only listCredentials + deleteCredential are exercised here; the rest are
// stubbed so the slice's import binding resolves.
vi.mock("@/api/vault/credentials", () => ({
  listCredentials: vi.fn(),
  deleteCredential: vi.fn(),
  createCredential: vi.fn(),
  updateCredential: vi.fn(),
  updateCredentialField: vi.fn(),
  healthcheckCredential: vi.fn(),
  healthcheckCredentialPreview: vi.fn(),
  listAllCredentialEvents: vi.fn(),
  createCredentialEvent: vi.fn(),
  updateCredentialEvent: vi.fn(),
  deleteCredentialEvent: vi.fn(),
}));
vi.mock("@/api/auth/connectors", () => ({
  createConnector: vi.fn(),
  deleteConnector: vi.fn(),
  listConnectors: vi.fn(),
}));
vi.mock("@/lib/utils/platform/crypto", () => ({
  encryptWithSessionKey: vi.fn(async (s: string) => s),
}));

import * as credApi from "@/api/vault/credentials";
import { createCredentialSlice } from "./credentialSlice";
import type { VaultStore } from "../../storeTypes";
import type { PersonaCredential } from "@/lib/bindings/PersonaCredential";

// Minimal Zustand-style harness: wires set/get around a plain state object so
// we can invoke slice actions without spinning up the full persona store.
function makeHarness() {
  let state = {} as VaultStore;
  const set = (
    partial: Partial<VaultStore> | ((s: VaultStore) => Partial<VaultStore>),
  ) => {
    const patch = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createCredentialSlice(set as never, get as never, {} as never);
  state = { ...state, ...slice };
  return { get: () => state };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Build a PersonaCredential with only the fields toCredentialMetadata reads.
function cred(id: string): PersonaCredential {
  return {
    id,
    name: id,
    serviceType: "github",
    encryptedData: "",
    iv: "",
    metadata: null,
    scopedResources: null,
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as PersonaCredential;
}

// The slice's fetch cache (createCachedFetch) is a module-level singleton with a
// 30s TTL, shared across tests in this file. Advance the fake clock by a wide
// margin per test so a prior test's freshness window can't gate this test's
// fetch, and so we can step past the TTL within a single test on demand.
let clockBase = 1_700_000_000_000;

describe("credentialSlice — delete vs. in-flight fetch race", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clockBase += 200_000;
    vi.setSystemTime(clockBase);
    vi.mocked(credApi.listCredentials).mockReset();
    vi.mocked(credApi.deleteCredential).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not resurrect a credential deleted while a fetch is in flight", async () => {
    const h = makeHarness();
    const d = deferred<PersonaCredential[]>();
    vi.mocked(credApi.listCredentials).mockReturnValue(d.promise);
    vi.mocked(credApi.deleteCredential).mockResolvedValue(true);

    // A fetch is already in flight; its snapshot (resolved later) still lists X.
    const fetchPromise = h.get().fetchCredentials();

    // The user deletes X before that fetch resolves.
    await h.get().deleteCredential("X");
    expect(h.get().credentials.find((c) => c.id === "X")).toBeUndefined();
    expect(h.get().recentlyDeletedCredentialIds.has("X")).toBe(true);

    // The stale fetch now resolves with a pre-delete snapshot that still has X.
    d.resolve([cred("A"), cred("X")]);
    await fetchPromise;

    const ids = h.get().credentials.map((c) => c.id);
    expect(ids).toContain("A");
    // The ghost row must NOT come back.
    expect(ids).not.toContain("X");
    // Backend snapshot still listed X, so the tombstone is retained for now.
    expect(h.get().recentlyDeletedCredentialIds.has("X")).toBe(true);
  });

  it("retires the tombstone once a fresh snapshot no longer lists the deleted id", async () => {
    const h = makeHarness();
    vi.mocked(credApi.deleteCredential).mockResolvedValue(true);

    // First fetch establishes A + X in state.
    vi.mocked(credApi.listCredentials).mockResolvedValueOnce([cred("A"), cred("X")]);
    await h.get().fetchCredentials();
    expect(h.get().credentials.map((c) => c.id).sort()).toEqual(["A", "X"]);

    // Delete X (optimistic removal + tombstone).
    await h.get().deleteCredential("X");
    expect(h.get().credentials.map((c) => c.id)).toEqual(["A"]);
    expect(h.get().recentlyDeletedCredentialIds.has("X")).toBe(true);

    // Step past the 30s cache TTL so the next call actually re-fetches.
    vi.setSystemTime(clockBase + 31_000);
    // Backend has now caught up: X is gone from the list.
    vi.mocked(credApi.listCredentials).mockResolvedValueOnce([cred("A")]);
    await h.get().fetchCredentials();

    expect(h.get().credentials.map((c) => c.id)).toEqual(["A"]);
    // The tombstone is retired once the backend confirms the deletion.
    expect(h.get().recentlyDeletedCredentialIds.has("X")).toBe(false);
  });

  it("returns the full list unchanged when there are no tombstones", async () => {
    const h = makeHarness();
    vi.mocked(credApi.listCredentials).mockResolvedValue([cred("A"), cred("B")]);

    await h.get().fetchCredentials();

    expect(h.get().credentials.map((c) => c.id).sort()).toEqual(["A", "B"]);
    expect(h.get().error).toBeNull();
    expect(h.get().recentlyDeletedCredentialIds.size).toBe(0);
  });
});
