import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';

/**
 * useProgressiveReveal — spread the *mounting* of an already-fetched list
 * across a short window so a large table doesn't "big-bang" every row into
 * the DOM on the same frame.
 *
 * The data is already in memory (paged in by `useLayeredList` / the store);
 * this hook only governs how many of those rows are handed to the renderer
 * at a time. Returned `count` starts at `initialCount` (one viewport) on the
 * first paint, then grows in chunks until it reaches `total` — landing within
 * ≈`targetMs` regardless of list size (100 rows and 1000 rows both finish in
 * roughly the same window, because the chunk size scales with `total`).
 *
 * Pair it with a virtualized list by slicing the data to `count`:
 *
 * ```ts
 * const reveal = useProgressiveReveal(rows.length, { resetKey: filterKey });
 * const shown = useMemo(() => rows.slice(0, reveal.count), [rows, reveal.count]);
 * const { parentRef, virtualizer } = useVirtualList(shown, ROW_HEIGHT);
 * ```
 *
 * Respects `prefers-reduced-motion` and `enabled: false` (off-screen tabs) by
 * revealing everything immediately. When `total` grows after the reveal has
 * settled (a "load more" page, a realtime arrival) the hook chases the new
 * total so the appended rows animate in too.
 */
export interface ProgressiveRevealOptions {
  /** Rows shown on the first paint — size to one viewport. Default 24. */
  initialCount?: number;
  /** Target time (ms) to reveal everything past the initial batch. Default 2000. */
  targetMs?: number;
  /** Minimum rows added per tick (keeps small lists lively). Default 6. */
  minChunk?: number;
  /** Delay (ms) between reveal ticks. Default 90. */
  intervalMs?: number;
  /** When false, reveal everything at once (e.g. an off-screen tab). Default true. */
  enabled?: boolean;
  /** Change this (filter key, view mode) to restart the reveal from `initialCount`. */
  resetKey?: string | number;
}

export interface ProgressiveRevealResult {
  /** Rows currently revealed — grows over time, clamped to `total`. */
  count: number;
  /** True while still revealing (`count < total`). */
  isRevealing: boolean;
  /**
   * Index where the most recent reveal wave started — items at indices in
   * `[newSince, count)` are the ones entering now. Feed `index - newSince` as
   * `RevealItem`'s `order` to stagger each item's fade within the wave.
   */
  newSince: number;
}

type Schedule = Required<
  Pick<ProgressiveRevealOptions, 'initialCount' | 'targetMs' | 'minChunk' | 'intervalMs'>
>;

const DEFAULTS: Schedule = { initialCount: 24, targetMs: 2000, minChunk: 6, intervalMs: 90 };

/**
 * Pure: rows to reveal on the next tick. The chunk is derived so the rows
 * remaining after the initial batch are exhausted within `targetMs` — large
 * lists get proportionally bigger chunks so wall-clock stays ≈ constant.
 * Exported for unit testing the cadence math without timers.
 */
export function nextRevealCount(current: number, total: number, opts: Schedule): number {
  if (current >= total) return total;
  const ticks = Math.max(1, Math.round(opts.targetMs / opts.intervalMs));
  const remaining = Math.max(0, total - opts.initialCount);
  const chunk = Math.max(opts.minChunk, Math.ceil(remaining / ticks));
  return Math.min(total, current + chunk);
}

export function useProgressiveReveal(
  total: number,
  options?: ProgressiveRevealOptions,
): ProgressiveRevealResult {
  const initialCount = options?.initialCount ?? DEFAULTS.initialCount;
  const targetMs = options?.targetMs ?? DEFAULTS.targetMs;
  const minChunk = options?.minChunk ?? DEFAULTS.minChunk;
  const intervalMs = options?.intervalMs ?? DEFAULTS.intervalMs;
  const enabled = options?.enabled ?? true;
  const resetKey = options?.resetKey;

  const reducedMotion = useReducedMotion();
  const revealAll = !enabled || reducedMotion;

  const [count, setCount] = useState(() => (revealAll ? total : Math.min(initialCount, total)));

  const totalRef = useRef(total);
  totalRef.current = total;
  const countRef = useRef(count);
  countRef.current = count;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickingRef = useRef(false);
  // Count just before the most recent reveal step — the wave's start index.
  const prevCountRef = useRef(0);

  // Latest-closure loop runner — reassigned each render so it reads fresh
  // schedule values, but only ever one timer chain runs at a time.
  const startLoopRef = useRef<() => void>(() => {});
  startLoopRef.current = () => {
    if (tickingRef.current) return;
    tickingRef.current = true;
    const sched: Schedule = { initialCount, targetMs, minChunk, intervalMs };
    const tick = () => {
      const cur = countRef.current;
      const next = nextRevealCount(cur, totalRef.current, sched);
      prevCountRef.current = cur;
      countRef.current = next;
      setCount(next);
      if (next < totalRef.current) {
        timerRef.current = setTimeout(tick, intervalMs);
      } else {
        tickingRef.current = false;
        timerRef.current = null;
      }
    };
    timerRef.current = setTimeout(tick, intervalMs);
  };

  // Reset + restart on filter/mode change or when the motion/enabled mode flips.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    tickingRef.current = false;
    prevCountRef.current = 0;

    if (revealAll) {
      countRef.current = totalRef.current;
      setCount(totalRef.current);
      return;
    }
    const start = Math.min(initialCount, totalRef.current);
    countRef.current = start;
    setCount(start);
    if (start < totalRef.current) startLoopRef.current();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      tickingRef.current = false;
    };
  }, [resetKey, revealAll, initialCount]);

  // Chase a growing total (load-more page / realtime arrival) once idle.
  useEffect(() => {
    if (revealAll) {
      countRef.current = total;
      setCount(total);
      return;
    }
    if (!tickingRef.current && countRef.current < total) startLoopRef.current();
  }, [total, revealAll]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const clamped = Math.min(count, total);
  return {
    count: clamped,
    isRevealing: clamped < total,
    newSince: Math.min(prevCountRef.current, clamped),
  };
}

/**
 * Surface-scoped entrance seen-sets that outlive the mount, keyed by
 * `surfaceKey` + `resetKey`. Bounded: at most 64 surfaces resident (least
 * recently created evicted first), each capped at {@link MAX_SEEN_IDS} ids
 * (oldest dropped first), so an infinite-scroll feed cannot grow it without end.
 */
const SURFACE_SEEN = createModuleCache<string, Set<string>>({ maxSize: 64 });
const MAX_SEEN_IDS = 2000;

function surfaceSeenKey(surfaceKey: string, resetKey: string | number | undefined): string {
  return `${surfaceKey}::${resetKey ?? ''}`;
}

/**
 * Companion to {@link useProgressiveReveal} for per-item entrance animations.
 *
 * Tracks which item ids have already played their entrance, so scrolling a
 * virtualized list never re-triggers the fade, and clears when `resetKey`
 * changes (a filter/view switch replays the cascade). Pair with the shared
 * `RevealItem` component.
 *
 * Where the seen-set lives:
 * - Without `surfaceKey` (the default): a per-mount ref. It dies with the
 *   component, so a surface that unmounts on navigation replays its cascade on
 *   every return.
 * - With `surfaceKey`: a module-scoped set per `surfaceKey` + `resetKey`, so
 *   returning to the same surface plays no cascade for ids it already showed,
 *   while a genuinely new id still enters alone. Pass the identity of "where
 *   you are" (a table id, a scroll-restore key), never a per-mount value.
 *
 * Reduced motion is unaffected: callers skip the entrance before consulting
 * the tracker.
 */
export function useRevealTracker(resetKey?: string | number, surfaceKey?: string): {
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
} {
  const seenRef = useRef<Set<string>>(new Set());
  const keyRef = useRef(resetKey);
  if (keyRef.current !== resetKey) {
    keyRef.current = resetKey;
    seenRef.current = new Set();
  }
  const moduleKey = surfaceKey === undefined ? undefined : surfaceSeenKey(surfaceKey, resetKey);
  // Reads never write (a render may call `hasEntered`); the module entry is
  // created by `markEntered`, which runs from an animationend handler.
  const hasEntered = useCallback(
    (id: string) =>
      moduleKey === undefined ? seenRef.current.has(id) : (SURFACE_SEEN.get(moduleKey)?.has(id) ?? false),
    [moduleKey],
  );
  const markEntered = useCallback(
    (id: string) => {
      if (moduleKey === undefined) {
        seenRef.current.add(id);
        return;
      }
      let seen = SURFACE_SEEN.get(moduleKey);
      if (!seen) {
        seen = new Set();
        SURFACE_SEEN.set(moduleKey, seen);
      }
      seen.add(id);
      if (seen.size > MAX_SEEN_IDS) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
    },
    [moduleKey],
  );
  return { hasEntered, markEntered };
}

/** Test-only: forget every surface-scoped seen-set. */
export function __resetSurfaceRevealForTests(): void {
  SURFACE_SEEN.clear();
}
