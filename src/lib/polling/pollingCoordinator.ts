/**
 * PollingCoordinator — single timer per cadence bucket.
 *
 * Background: 7+ surfaces each spun their own setInterval/setTimeout to poll
 * IPC commands (badge counts, cloud reviews, observability, network status,
 * running executions). Their first ticks fired at different offsets within a
 * window, so a "30s refresh" produced several desynchronized IPC bursts —
 * SQLite paid cache-warm cost multiple times and Tauri serialization happened
 * once per ticker.
 *
 * Design: one timer per bucket (5s / 12s / 15s / 30s / 60s). Tickers register
 * a function plus an optional predicate. On each tick the coordinator
 * iterates the bucket's tickers, skips those whose predicate returns false,
 * and fires the rest in parallel via Promise.allSettled. Visibility hidden
 * pauses every bucket; on regain the next tick fires immediately so users
 * don't stare at stale state while the bucket waits out its interval.
 */

import {
  getDocumentVisible,
  subscribeDocumentVisibility,
} from "@/lib/documentVisibility";
import { silentCatch } from "@/lib/silentCatch";

/** Supported heartbeat buckets, in ms. Tickers are rounded to the nearest. */
const BUCKETS = [5_000, 12_000, 15_000, 30_000, 60_000] as const;
type Bucket = (typeof BUCKETS)[number];

export interface TickerOptions {
  /** Desired cadence in ms. Will be rounded to nearest supported bucket. */
  interval: number;
  /** Optional gate; if returns false at tick time, the run is skipped. */
  shouldRun?: () => boolean;
  /** Keep firing while the document is hidden (default: false). */
  runWhileHidden?: boolean;
  /** Fire once immediately on register (default: true). */
  fireOnRegister?: boolean;
}

export interface TickerHandle {
  readonly id: string;
  readonly bucket: Bucket;
  dispose: () => void;
}

interface InternalTicker {
  id: string;
  fn: () => unknown | Promise<unknown>;
  options: TickerOptions;
  inFlight: boolean;
}

interface BucketState {
  cadence: Bucket;
  tickers: Map<string, InternalTicker>;
  timerId: ReturnType<typeof setTimeout> | null;
  /** Wall-clock ms of the next scheduled tick (used for visibility resume). */
  nextTickAt: number;
}

function pickBucket(interval: number): Bucket {
  let best: Bucket = BUCKETS[0];
  let bestDelta = Math.abs(interval - best);
  for (const b of BUCKETS) {
    const d = Math.abs(interval - b);
    if (d < bestDelta) {
      best = b;
      bestDelta = d;
    }
  }
  return best;
}

export class PollingCoordinator {
  private buckets = new Map<Bucket, BucketState>();
  private idCounter = 0;
  private visible: boolean;
  private unsubVisibility: (() => void) | null = null;

  constructor() {
    this.visible = getDocumentVisible();
    this.unsubVisibility = subscribeDocumentVisibility((v) => {
      const wasVisible = this.visible;
      this.visible = v;
      if (!wasVisible && v) {
        this.onVisibilityRegained();
      } else if (wasVisible && !v) {
        this.onVisibilityLost();
      }
    });
  }

  register(
    name: string,
    fn: () => unknown | Promise<unknown>,
    options: TickerOptions,
  ): TickerHandle {
    const bucket = pickBucket(options.interval);
    const id = `${name}#${++this.idCounter}`;
    const ticker: InternalTicker = {
      id,
      fn,
      options,
      inFlight: false,
    };

    let state = this.buckets.get(bucket);
    if (!state) {
      state = {
        cadence: bucket,
        tickers: new Map(),
        timerId: null,
        nextTickAt: 0,
      };
      this.buckets.set(bucket, state);
    }
    state.tickers.set(id, ticker);

    const shouldFireImmediately = options.fireOnRegister ?? true;
    if (shouldFireImmediately && this.shouldRunTicker(ticker)) {
      void this.runTicker(ticker);
    }

    this.ensureBucketTimer(state);

    return {
      id,
      bucket,
      dispose: () => this.dispose(bucket, id),
    };
  }

  /** Force-fire every ticker whose predicate currently passes. */
  flush(): void {
    for (const state of this.buckets.values()) {
      for (const ticker of state.tickers.values()) {
        if (this.shouldRunTicker(ticker)) {
          void this.runTicker(ticker);
        }
      }
    }
  }

  /**
   * For tests/diagnostics. Returns a snapshot of which buckets are active and
   * how many tickers each holds.
   */
  stats(): { bucket: Bucket; tickers: number; nextTickInMs: number }[] {
    const now = Date.now();
    return Array.from(this.buckets.values()).map((s) => ({
      bucket: s.cadence,
      tickers: s.tickers.size,
      nextTickInMs: s.nextTickAt > 0 ? Math.max(0, s.nextTickAt - now) : -1,
    }));
  }

  /** Dispose the coordinator entirely (rare — used in tests / teardown). */
  destroy(): void {
    for (const state of this.buckets.values()) {
      if (state.timerId !== null) clearTimeout(state.timerId);
      state.tickers.clear();
    }
    this.buckets.clear();
    this.unsubVisibility?.();
    this.unsubVisibility = null;
  }

  // ---- internals ---------------------------------------------------------

  private dispose(bucket: Bucket, id: string): void {
    const state = this.buckets.get(bucket);
    if (!state) return;
    state.tickers.delete(id);
    if (state.tickers.size === 0) {
      if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
      }
      this.buckets.delete(bucket);
    }
  }

  private ensureBucketTimer(state: BucketState): void {
    if (state.timerId !== null) return;
    if (!this.visible && !this.bucketHasHiddenTickers(state)) {
      state.nextTickAt = 0;
      return;
    }
    state.nextTickAt = Date.now() + state.cadence;
    state.timerId = setTimeout(() => this.onBucketTick(state), state.cadence);
  }

  private bucketHasHiddenTickers(state: BucketState): boolean {
    for (const ticker of state.tickers.values()) {
      if (ticker.options.runWhileHidden) return true;
    }
    return false;
  }

  private onBucketTick(state: BucketState): void {
    state.timerId = null;
    if (state.tickers.size === 0) {
      this.buckets.delete(state.cadence);
      return;
    }
    if (this.visible || this.bucketHasHiddenTickers(state)) {
      for (const ticker of state.tickers.values()) {
        if (!this.visible && !ticker.options.runWhileHidden) continue;
        if (this.shouldRunTicker(ticker)) {
          void this.runTicker(ticker);
        }
      }
    }
    this.ensureBucketTimer(state);
  }

  private shouldRunTicker(ticker: InternalTicker): boolean {
    if (ticker.inFlight) return false;
    if (!ticker.options.shouldRun) return true;
    try {
      return ticker.options.shouldRun() !== false;
    } catch {
      return false;
    }
  }

  private async runTicker(ticker: InternalTicker): Promise<void> {
    ticker.inFlight = true;
    try {
      await ticker.fn();
    } catch (err) {
      // One failing ticker must not poison the bucket loop; surface via
      // Sentry breadcrumb so production failures remain debuggable.
      silentCatch(`pollingCoordinator:${ticker.id}`)(err);
    } finally {
      ticker.inFlight = false;
    }
  }

  private onVisibilityLost(): void {
    for (const state of this.buckets.values()) {
      if (this.bucketHasHiddenTickers(state)) continue;
      if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
        state.nextTickAt = 0;
      }
    }
  }

  private onVisibilityRegained(): void {
    for (const state of this.buckets.values()) {
      if (state.timerId !== null) continue;
      // Fire all eligible tickers immediately so users see fresh state.
      for (const ticker of state.tickers.values()) {
        if (this.shouldRunTicker(ticker)) {
          void this.runTicker(ticker);
        }
      }
      this.ensureBucketTimer(state);
    }
  }
}

// ---- singleton via globalThis (HMR-safe per CLAUDE.md convention) --------

const GLOBAL_KEY = "__personasPollingCoordinator";
type GlobalWithCoord = typeof globalThis & {
  [GLOBAL_KEY]?: PollingCoordinator;
};

export function getPollingCoordinator(): PollingCoordinator {
  const g = globalThis as GlobalWithCoord;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new PollingCoordinator();
  }
  return g[GLOBAL_KEY];
}

/** Test-only: replace the global coordinator with a fresh one. */
export function __resetPollingCoordinatorForTests(): void {
  const g = globalThis as GlobalWithCoord;
  g[GLOBAL_KEY]?.destroy();
  g[GLOBAL_KEY] = new PollingCoordinator();
}
