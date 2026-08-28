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
