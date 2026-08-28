/**
 * Performance Timeline instrumentation for Zustand store async actions.
 *
 * Wraps an async function with `performance.mark()` / `performance.measure()`
 * so store action latency shows up in the browser Performance tab and can be
 * correlated with rendering performance via DevTools.
 *
 * Usage:
 *   measureStoreAction("store:fetchDashboard", () => fetchDashboard(days))
 */

import { silentCatch } from "@/lib/silentCatch";

const PREFIX = "store:";

/**
 * Execute `fn`, bracketing it with Performance Timeline marks.
 *
 * Creates:
 *   - mark  `store:<name>:start`   (cleared once the measure exists)
 *   - mark  `store:<name>:end`     (cleared once the measure exists)
 *   - measure `store:<name>` (start → end)
 *
 * If `fn` throws, the end-mark and measure are still recorded (with the
 * measure detail containing `{ error: true }`), then the error is re-thrown.
 *
 * Two things the first version got wrong, both invisible until a long session:
 *
 *  1. **Marks were never cleared.** Two marks per call, on polling paths, in a
 *     desktop app whose session runs for days — an unbounded Performance
 *     Timeline buffer. There were zero `clearMarks`/`clearMeasures` calls
 *     anywhere in `src/`. The measure retains its timing after its marks are
 *     deleted, so clearing them costs nothing but the retention.
 *  2. **`performance.measure` sat unguarded in `finally`.** If it threw — a
 *     missing start mark, a buffer the environment cleared underneath it — the
 *     exception REPLACED the error propagating out of `fn()`, and the caller
 *     saw a perf failure where the real failure used to be. Instrumentation
 *     must never be able to eat the thing it is instrumenting.
 */
export async function measureStoreAction<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const label = name.startsWith(PREFIX) ? name : `${PREFIX}${name}`;
  const startMark = `${label}:start`;
  const endMark = `${label}:end`;

  performance.mark(startMark);
  let error = false;
  try {
    return await fn();
  } catch (err) {
    error = true;
    throw err;
  } finally {
    try {
      performance.mark(endMark);
      performance.measure(label, {
        start: startMark,
        end: endMark,
        detail: { error },
      });
    } catch (perfErr) {
      // Breadcrumb only. Instrumentation must never replace the caller's error,
      // so this is swallowed here rather than allowed to propagate out of
      // `finally` — but a Performance Timeline that stops working is worth a
      // trail when someone later wonders why the measures went missing.
      silentCatch(`storePerf:measure:${label}`)(perfErr);
    } finally {
      // The measure keeps its timing data after its marks are deleted, so this
      // is what stops the timeline growing for the life of the session.
      performance.clearMarks(startMark);
      performance.clearMarks(endMark);
    }
  }
}
