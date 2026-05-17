import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PollingCoordinator,
  getPollingCoordinator,
  __resetPollingCoordinatorForTests,
} from "../polling/pollingCoordinator";

describe("PollingCoordinator", () => {
  let coord: PollingCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    coord = new PollingCoordinator();
  });

  afterEach(() => {
    coord.destroy();
    vi.useRealTimers();
  });

  it("rounds an interval to the nearest supported bucket", () => {
    coord.register("a", vi.fn(), { interval: 28_000, fireOnRegister: false });
    coord.register("b", vi.fn(), { interval: 7_000, fireOnRegister: false });
    coord.register("c", vi.fn(), { interval: 14_000, fireOnRegister: false });
    const buckets = coord.stats().map((s) => s.bucket).sort((x, y) => x - y);
    expect(buckets).toEqual([5_000, 15_000, 30_000]);
  });

  it("co-locates two tickers with the same cadence in one bucket", () => {
    coord.register("a", vi.fn(), { interval: 30_000, fireOnRegister: false });
    coord.register("b", vi.fn(), { interval: 30_000, fireOnRegister: false });
    const stats = coord.stats();
    expect(stats).toHaveLength(1);
    expect(stats[0].tickers).toBe(2);
  });

  it("fires the ticker once on register by default", () => {
    const fn = vi.fn();
    coord.register("a", fn, { interval: 30_000 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not fire on register when fireOnRegister=false", () => {
    const fn = vi.fn();
    coord.register("a", fn, { interval: 30_000, fireOnRegister: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it("fires every ticker in a bucket on each tick", async () => {
    const a = vi.fn();
    const b = vi.fn();
    coord.register("a", a, { interval: 30_000, fireOnRegister: false });
    coord.register("b", b, { interval: 30_000, fireOnRegister: false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("skips a tick when shouldRun returns false", async () => {
    const fn = vi.fn();
    let gate = false;
    coord.register("a", fn, {
      interval: 30_000,
      fireOnRegister: false,
      shouldRun: () => gate,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fn).not.toHaveBeenCalled();
    gate = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("removes a bucket once all its tickers dispose", () => {
    const h1 = coord.register("a", vi.fn(), { interval: 30_000, fireOnRegister: false });
    const h2 = coord.register("b", vi.fn(), { interval: 30_000, fireOnRegister: false });
    expect(coord.stats()).toHaveLength(1);
    h1.dispose();
    expect(coord.stats()).toHaveLength(1);
    h2.dispose();
    expect(coord.stats()).toHaveLength(0);
  });

  it("does not re-enter a ticker that is already in-flight", async () => {
    let resolve!: () => void;
    const fn = vi.fn(
      () => new Promise<void>((r) => { resolve = r; }),
    );
    coord.register("a", fn, { interval: 5_000, fireOnRegister: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    // Still in-flight: second tick must NOT call fn again.
    expect(fn).toHaveBeenCalledTimes(1);
    resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("swallows ticker errors so one failure doesn't poison the bucket", async () => {
    const bad = vi.fn().mockRejectedValue(new Error("boom"));
    const good = vi.fn();
    coord.register("bad", bad, { interval: 5_000, fireOnRegister: false });
    coord.register("good", good, { interval: 5_000, fireOnRegister: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bad).toHaveBeenCalledTimes(2);
    expect(good).toHaveBeenCalledTimes(2);
  });

  it("getPollingCoordinator returns a stable singleton", () => {
    __resetPollingCoordinatorForTests();
    const a = getPollingCoordinator();
    const b = getPollingCoordinator();
    expect(a).toBe(b);
    __resetPollingCoordinatorForTests();
    const c = getPollingCoordinator();
    expect(c).not.toBe(a);
  });
});
