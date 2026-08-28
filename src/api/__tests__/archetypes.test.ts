import { describe, it, expect, beforeEach } from "vitest";
import { mockedTauriInvoke, resetInvokeMocks } from "@/test/tauriMock";
import { _clearAutoDedupForTests } from "@/lib/tauriInvoke";
import { listArchetypes, __resetArchetypeCacheForTests } from "@/api/archetypes";

const CATALOG = { archetypes: [{ id: "analyst" }], memory_strategies: [] };

/**
 * The archetype catalog is `include_str!`-embedded in the binary, so it cannot
 * change within a session — the module's own contract said "callers cache it"
 * and no caller did. These assert the cache exists AND that it does not cache
 * a failure, which is what would silently disarm the compose surface's retry.
 */
describe("api/archetypes session cache", () => {
  beforeEach(() => {
    resetInvokeMocks();
    __resetArchetypeCacheForTests();
  });

  it("reaches the backend once no matter how many callers ask", async () => {
    mockedTauriInvoke.mockResolvedValue(CATALOG);

    const first = await listArchetypes();
    // Expire `tauriInvoke`'s 250 ms auto-dedup window, so the second call is
    // held by THIS module's session cache and not by the burst guard — without
    // this the test would pass even with the cache deleted.
    _clearAutoDedupForTests();
    const second = await listArchetypes();

    expect(second).toBe(first);
    expect(mockedTauriInvoke).toHaveBeenCalledTimes(1);
  });

  it("shares one round-trip between concurrent callers", async () => {
    mockedTauriInvoke.mockResolvedValue(CATALOG);

    const [a, b] = await Promise.all([listArchetypes(), listArchetypes()]);

    expect(a).toBe(b);
    expect(mockedTauriInvoke).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejection, so a retry can still succeed", async () => {
    mockedTauriInvoke.mockRejectedValueOnce(new Error("ipc down"));
    await expect(listArchetypes()).rejects.toThrow("ipc down");

    mockedTauriInvoke.mockResolvedValue(CATALOG);
    await expect(listArchetypes()).resolves.toEqual(CATALOG);
  });
});
