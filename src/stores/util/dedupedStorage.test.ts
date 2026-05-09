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
});
