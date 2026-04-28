import { useEffect, useState, type ReactNode } from 'react';

/**
 * `DeferUntilIdle` postpones rendering its children until the browser is idle
 * (or the next animation frame, depending on `priority`). Use it to keep
 * heavy below-fold trees out of the initial DOM commit so the renderer
 * doesn't hitch — particularly relevant for Tauri/WebView2, which historically
 * hangs when too many nodes are committed at once.
 *
 * Until the threshold is met, `<DeferUntilIdle>` renders the optional
 * `fallback` (or `null`). Once the threshold fires, children replace the
 * fallback in a single re-render — there is no transition or layout shift
 * other than what the children themselves animate.
 *
 * ## Priorities
 *
 * - `idle` (default) — wait for `requestIdleCallback`. Best for genuinely
 *   non-critical content (collapsed panels, far-below-fold sections).
 * - `next-frame` — wait one `requestAnimationFrame`. Use when the content
 *   needs to render quickly but should not block the first paint. This is
 *   the original WelcomeLayout band-aid pattern, now testable.
 * - `mount-after` — render synchronously on mount; equivalent to no defer.
 *   Useful as a kill-switch in tests or for users with `prefers-reduced-motion`
 *   handled at a higher level.
 *
 * On WebView2 (Edge Chromium) `requestIdleCallback` exists; on legacy Safari
 * it does not, so the implementation falls back to `setTimeout(0)` — which
 * is conservative but always fires in the next macrotask.
 *
 * The `fallback` prop is rendered **once**, before the threshold fires. After
 * children mount, the fallback is unmounted; do not put state-bearing UI
 * there.
 */
export type DeferPriority = 'idle' | 'next-frame' | 'mount-after';

interface DeferUntilIdleProps {
  children: ReactNode;
  /** When to commit children to the DOM. Default: `idle`. */
  priority?: DeferPriority;
  /** Optional placeholder rendered until `children` mount. */
  fallback?: ReactNode;
  /**
   * Test-only escape hatch. When `true`, children render synchronously on
   * mount regardless of priority. Use to keep snapshot/RTL tests stable.
   */
  immediate?: boolean;
}

type IdleCallbackHandle = number;

interface IdleApi {
  requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
}

export function DeferUntilIdle({
  children,
  priority = 'idle',
  fallback = null,
  immediate = false,
}: DeferUntilIdleProps) {
  const [ready, setReady] = useState(immediate || priority === 'mount-after');

  useEffect(() => {
    if (ready) return;
    if (priority === 'mount-after') {
      setReady(true);
      return;
    }

    if (priority === 'next-frame') {
      const id = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(id);
    }

    // priority === 'idle'
    const w = window as unknown as IdleApi;
    if (typeof w.requestIdleCallback === 'function' && typeof w.cancelIdleCallback === 'function') {
      const handle = w.requestIdleCallback(() => setReady(true), { timeout: 500 });
      return () => w.cancelIdleCallback?.(handle);
    }
    // Fallback for environments without rIC (Safari, jsdom): use a 0ms
    // timer which always fires in the next macrotask. Less ideal than rIC
    // but consistent and testable.
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, [priority, ready]);

  return <>{ready ? children : fallback}</>;
}
