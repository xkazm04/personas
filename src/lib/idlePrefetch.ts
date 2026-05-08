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

/**
 * Schedule a batch of lazy-chunk imports during idle time. Each import is
 * placed in its own idle slice so a long burst can't monopolise a single
 * deadline.
 */
export function idlePrefetch(imports: readonly ImportFn[]): void {
  for (const fn of imports) {
    scheduleIdle(() => {
      fn().catch(silentCatch("idlePrefetch:chunk"));
    });
  }
}
