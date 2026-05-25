/**
 * Idle-time prefetch for lazy chunks.
 *
 * `lazy(() => import(...))` only fetches + parses + evaluates a chunk when the
 * component first renders. For deferred overlays (CommandPalette, mini player,
 * companion panel, etc.) that means the *first* keypress / open pays the
 * 80–200 ms chunk-resolution cost — perceived as a "sluggish" cold open.
 *
 * `idlePrefetch` schedules `import()` for each module during browser idle
 * time, so the chunk lands in the V8 module cache before the user triggers it.
 * No component mounts; React.lazy() on a later render hits the cached module
 * promise and resolves synchronously on the next microtask.
 *
 * Failures are swallowed — a missed prefetch is not fatal; React.lazy() will
 * retry the import on actual mount and surface any real error there.
 */
import { silentCatch } from "./silentCatch";

type ImportFn = () => Promise<unknown>;

interface IdleDeadline {
  didTimeout: boolean;
  timeRemaining: () => number;
}

interface IdleApi {
  requestIdleCallback?: (
    cb: (deadline: IdleDeadline) => void,
    opts?: { timeout: number },
  ) => number;
}

function scheduleIdle(cb: () => void): void {
  const ric = (globalThis as unknown as IdleApi).requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => cb(), { timeout: 5000 });
    return;
  }
  // MessageChannel fallback: posts run as a task (not microtask), so the
  // browser can render between scheduled callbacks. Avoids setTimeout's 4 ms
  // clamp without blocking the microtask queue.
  if (typeof MessageChannel !== "undefined") {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      cb();
    };
    channel.port2.postMessage(null);
    return;
  }
  setTimeout(cb, 0);
}

interface IdlePrefetchOptions {
  /**
   * Delay (ms) before the first chunk is scheduled. Keeps speculative
   * prefetch out of the most contended startup window — the seconds right
   * after load, where chunk evaluation showed up as ~800ms main-thread
   * freezes in the 2026-05-25 profiling pass. Default 0 (schedule immediately
   * on the next idle slice).
   */
  initialDelayMs?: number;
}

/**
 * Schedule a batch of lazy-chunk imports during idle time, **sequentially** —
 * the next import is scheduled only after the previous one has fully fetched
 * and evaluated. `import()` resolution triggers a synchronous, non-interruptible
 * V8 parse+evaluate that ignores the idle deadline; scheduling all N at once
 * (the previous behavior) let them evaluate back-to-back in one burst the
 * moment the browser went idle (or when the 5s idle-timeout fired under load),
 * stacking into a multi-hundred-ms main-thread block. Draining one chunk per
 * idle slice spreads that cost across many idle periods so no single slice
 * blocks long enough to drop frames.
 *
 * Order matters: pass the most-likely-needed chunks first, since later entries
 * warm noticeably later under this serialized schedule.
 *
 * Returns a cancel function that stops any not-yet-scheduled imports (a chunk
 * already mid-fetch still completes). Failures are swallowed — a missed
 * prefetch is not fatal; React.lazy() retries the import on actual mount.
 */
export function idlePrefetch(
  imports: readonly ImportFn[],
  opts: IdlePrefetchOptions = {},
): () => void {
  let cancelled = false;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  const queue = [...imports];

  const pump = (): void => {
    if (cancelled) return;
    const fn = queue.shift();
    if (!fn) return;
    scheduleIdle(() => {
      if (cancelled) return;
      // Schedule the next chunk only after this one settles, so at most one
      // chunk evaluates per idle slice.
      void fn().catch(silentCatch("idlePrefetch:chunk")).finally(pump);
    });
  };

  if (opts.initialDelayMs && opts.initialDelayMs > 0) {
    startTimer = setTimeout(pump, opts.initialDelayMs);
  } else {
    pump();
  }

  return () => {
    cancelled = true;
    if (startTimer) clearTimeout(startTimer);
  };
}
