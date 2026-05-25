import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCachedFetch } from "../createCachedFetch";

describe("createCachedFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses concurrent callers onto a single in-flight fetch", async () => {
    const fetcher = vi.fn(async () => {});
    const c = createCachedFetch({ ttlMs: 1000 });
    await Promise.all([
      c.run("k", fetcher),
      c.run("k", fetcher),
      c.run("k", fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves from the freshness window and invokes onHit", async () => {
    const fetcher = vi.fn(async () => {});
    const onHit = vi.fn();
    const c = createCachedFetch({ ttlMs: 1000 });
    await c.run("k", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500); // still fresh
    await c.run("k", fetcher, onHit);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onHit).toHaveBeenCalledWith("k");
  });

  it("refetches after the TTL window expires", async () => {
    const fetcher = vi.fn(async () => {});
    const c = createCachedFetch({ ttlMs: 1000 });
    await c.run("k", fetcher);
    vi.advanceTimersByTime(1001);
    await c.run("k", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed fetch (no freshness recorded)", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    });
    const c = createCachedFetch({ ttlMs: 1000 });
    await c.run("k", fetcher); // swallowed (rethrow defaults false)
    await c.run("k", fetcher); // immediately retries — failure was not cached
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("propagates errors when rethrow is true", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    });
    const c = createCachedFetch({ ttlMs: 1000, rethrow: true });
    await expect(c.run("k", fetcher)).rejects.toThrow("boom");
  });

  it("keys are independent", async () => {
    const fetcher = vi.fn(async () => {});
    const c = createCachedFetch({ ttlMs: 1000 });
    await c.run("a", fetcher);
    await c.run("b", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidate forces the next run to refetch", async () => {
    const fetcher = vi.fn(async () => {});
    const c = createCachedFetch({ ttlMs: 10_000 });
    await c.run("k", fetcher);
    c.invalidate("k");
    await c.run("k", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
