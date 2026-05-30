import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTtlValueCache } from "../createTtlValueCache";

describe("createTtlValueCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined on a cold miss", () => {
    const c = createTtlValueCache<number>(1000);
    expect(c.get("k")).toBeUndefined();
  });

  it("serves a set value within the TTL window", () => {
    const c = createTtlValueCache<number>(1000);
    c.set("k", 42);
    vi.advanceTimersByTime(500);
    expect(c.get("k")).toBe(42);
  });

  it("expires a value once the TTL window elapses", () => {
    const c = createTtlValueCache<number>(1000);
    c.set("k", 42);
    vi.advanceTimersByTime(1000); // boundary is exclusive (< ttlMs)
    expect(c.get("k")).toBeUndefined();
  });

  it("keys entries independently", () => {
    const c = createTtlValueCache<string>(1000);
    c.set("a", "alpha");
    c.set("b", "beta");
    expect(c.get("a")).toBe("alpha");
    expect(c.get("b")).toBe("beta");
  });

  it("delete drops a single key; clear drops all", () => {
    const c = createTtlValueCache<number>(1000);
    c.set("a", 1);
    c.set("b", 2);
    c.delete("a");
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    c.clear();
    expect(c.get("b")).toBeUndefined();
  });

  it("set refreshes the timestamp (re-set extends freshness)", () => {
    const c = createTtlValueCache<number>(1000);
    c.set("k", 1);
    vi.advanceTimersByTime(900);
    c.set("k", 2); // re-stamp
    vi.advanceTimersByTime(900); // 1800ms since first set, 900ms since re-set
    expect(c.get("k")).toBe(2);
  });
});
