import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  _resetDedupCacheForTests,
  createDedupedStateStorage,
} from "./dedupedStorage";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

describe("createDedupedStateStorage", () => {
  beforeEach(() => {
    _resetDedupCacheForTests();
  });

  it("skips writes when the serialized payload is unchanged", () => {
    const mem = new MemoryStorage();
    const setItemSpy = vi.spyOn(mem, "setItem");
    const storage = createDedupedStateStorage(mem);

    storage.setItem("k", "payload-A");
    storage.setItem("k", "payload-A");
    storage.setItem("k", "payload-A");

    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(mem.getItem("k")).toBe("payload-A");
  });

  it("writes when payload changes", () => {
    const mem = new MemoryStorage();
    const setItemSpy = vi.spyOn(mem, "setItem");
    const storage = createDedupedStateStorage(mem);

    storage.setItem("k", "v1");
    storage.setItem("k", "v2");
    storage.setItem("k", "v3");

    expect(setItemSpy).toHaveBeenCalledTimes(3);
    expect(mem.getItem("k")).toBe("v3");
  });

  it("dedupes per key, not globally", () => {
    const mem = new MemoryStorage();
    const setItemSpy = vi.spyOn(mem, "setItem");
    const storage = createDedupedStateStorage(mem);

    storage.setItem("a", "same");
    storage.setItem("b", "same");
    storage.setItem("a", "same"); // skip
    storage.setItem("b", "same"); // skip

    expect(setItemSpy).toHaveBeenCalledTimes(2);
  });

  it("removeItem clears dedup cache so subsequent setItem actually writes", () => {
    const mem = new MemoryStorage();
    const setItemSpy = vi.spyOn(mem, "setItem");
    const storage = createDedupedStateStorage(mem);

    storage.setItem("k", "v1");
    storage.removeItem("k");
    storage.setItem("k", "v1");

    expect(setItemSpy).toHaveBeenCalledTimes(2);
  });

  it("getItem reads through to underlying storage", () => {
    const mem = new MemoryStorage();
    mem.setItem("k", "preexisting");
    const storage = createDedupedStateStorage(mem);

    expect(storage.getItem("k")).toBe("preexisting");
  });

  // -- Fail-soft: a storage write that throws ---------------------------
  //
  // Every persist() in the app writes through this adapter, so a
  // QuotaExceededError escaping here would surface as a thrown set() on an
  // ordinary selection change.

  class ThrowingStorage extends MemoryStorage {
    failNext = true;
    override setItem(key: string, value: string): void {
      if (this.failNext) {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      super.setItem(key, value);
    }
  }

  it("swallows a quota failure instead of throwing out of setItem", () => {
    const mem = new ThrowingStorage();
    const storage = createDedupedStateStorage(mem);

    expect(() => storage.setItem("k", "payload")).not.toThrow();
    expect(mem.getItem("k")).toBeNull();
  });

  it("does not record a payload that was never written, so the retry rewrites", () => {
    const mem = new ThrowingStorage();
    const storage = createDedupedStateStorage(mem);

    storage.setItem("k", "payload");
    mem.failNext = false;
    // Same payload again — the dedupe must NOT skip it, because the first
    // attempt never reached the disk.
    storage.setItem("k", "payload");

    expect(mem.getItem("k")).toBe("payload");
  });

  it("reports a failing key once, not once per write", () => {
    const mem = new ThrowingStorage();
    const storage = createDedupedStateStorage(mem);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    storage.setItem("k", "a");
    storage.setItem("k", "b");
    storage.setItem("k", "c");

    expect(consoleSpy.mock.calls.length).toBeLessThanOrEqual(1);
    consoleSpy.mockRestore();
  });
});
