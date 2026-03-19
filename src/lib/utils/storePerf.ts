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

const PREFIX = "store:";

/**
 * Execute `fn`, bracketing it with Performance Timeline marks.
 *
 * Creates:
 *   - mark  `store:<name>:start`
 *   - mark  `store:<name>:end`
 *   - measure `store:<name>` (start → end)
 *
 * If `fn` throws, the end-mark and measure are still recorded (with the
 * measure detail containing `{ error: true }`), then the error is re-thrown.
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
    performance.mark(endMark);
    performance.measure(label, {
      start: startMark,
      end: endMark,
      detail: { error },
    });
  }
}
