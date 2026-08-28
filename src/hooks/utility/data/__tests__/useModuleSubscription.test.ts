import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createModuleCache, useModuleSubscription } from "../useModuleSubscription";

describe("createModuleCache reads are pure", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("reports an expired entry as absent WITHOUT evicting it", () => {
    vi.useFakeTimers();
    const cache = createModuleCache<string, number>({ ttlMs: 1000 });
    cache.set("a", 1);

    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);

    vi.advanceTimersByTime(1500);

    // Logically absent...
    expect(cache.get("a")).toBeUndefined();
    expect(cache.has("a")).toBe(false);

    // ...but the read did not mutate the store. `useModuleSubscription`
    // calls `get` during render, so a mutating read would be a side effect
    // in the render phase. This assertion is what fails against the previous
    // implementation, where `get`/`has` evicted the expired entry.
    const del = vi.spyOn(Map.prototype, "delete");
    try {
      cache.get("a");
      cache.has("a");
      expect(del).not.toHaveBeenCalled();
    } finally {
      del.mockRestore();
    }

    cache.set("a", 2);
    expect(cache.get("a")).toBe(2);
  });

  it("invalidate still evicts", () => {
    const cache = createModuleCache<string, number>();
    cache.set("a", 1);
    cache.invalidate("a");
    expect(cache.has("a")).toBe(false);
  });
});

describe("useModuleSubscription", () => {
  it("returns the value for its key and re-renders on notify", () => {
    const cache = createModuleCache<string, number>();
    cache.set("k", 1);

    const { result } = renderHook(() => useModuleSubscription(cache, "k"));
    expect(result.current).toBe(1);

    act(() => {
      cache.set("k", 2);
      cache.notify();
    });
    // The value rendered is the value that triggered the render — the tear
    // useSyncExternalStore exists to prevent.
    expect(result.current).toBe(2);
  });

  it("unsubscribes on unmount", () => {
    const cache = createModuleCache<string, number>();
    const { unmount } = renderHook(() => useModuleSubscription(cache, "k"));
    expect(cache.subscriberCount).toBe(1);
    unmount();
    expect(cache.subscriberCount).toBe(0);
  });

  it("tracks a changing key", () => {
    const cache = createModuleCache<string, number>();
    cache.set("a", 1);
    cache.set("b", 2);

    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => useModuleSubscription(cache, k),
      { initialProps: { k: "a" } },
    );
    expect(result.current).toBe(1);

    rerender({ k: "b" });
    expect(result.current).toBe(2);
  });
});

describe("createModuleCache is bounded when maxSize is given", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("grows without limit when maxSize is omitted", () => {
    const cache = createModuleCache<string, number>();
    for (let i = 0; i < 500; i += 1) cache.set(`k${i}`, i);
    expect(cache.size).toBe(500);
  });

  it("never exceeds maxSize, evicting the least-recently-written entry", () => {
    const cache = createModuleCache<string, number>({ maxSize: 3 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);

    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBe(4);
  });

  it("re-writing a key refreshes its recency instead of aging out", () => {
    const cache = createModuleCache<string, number>({ maxSize: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // "a" is now the newest, so "b" is next to go
    cache.set("c", 3);

    expect(cache.size).toBe(2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
  });

  it("evicts expired entries before live ones", () => {
    vi.useFakeTimers();
    const cache = createModuleCache<string, number>({ ttlMs: 1000, maxSize: 2 });
    cache.set("old", 1);
    vi.advanceTimersByTime(1500);
    cache.set("fresh", 2);
    cache.set("newest", 3);

    // "old" was written first AND is expired, so it goes; both live entries stay.
    expect(cache.size).toBe(2);
    expect(cache.get("fresh")).toBe(2);
    expect(cache.get("newest")).toBe(3);
  });

  it("clamps a sub-1 maxSize to 1 and ignores a non-finite one", () => {
    const zero = createModuleCache<string, number>({ maxSize: 0 });
    zero.set("a", 1);
    zero.set("b", 2);
    expect(zero.size).toBe(1);
    expect(zero.get("b")).toBe(2);

    const nan = createModuleCache<string, number>({ maxSize: Number.NaN });
    nan.set("a", 1);
    nan.set("b", 2);
    // NaN is not a usable bound; it falls back to unbounded rather than to 1.
    expect(nan.size).toBe(2);
  });

  it("does not evict during a render read", () => {
    const cache = createModuleCache<string, number>({ maxSize: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    renderHook(() => useModuleSubscription(cache, "a"));
    expect(cache.size).toBe(2);
  });
});
