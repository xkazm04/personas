import { Suspense, useEffect, useState, type ReactNode } from 'react';

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
 *
 * ## Staggered entrance
 *
 * For a surface whose deep parts should arrive one after another rather than
 * in one commit, give each part an `order`: once the threshold fires, part
 * `n` waits a further `n * stepMs` before it mounts. `enter` wraps the
 * children in a one-shot `animate-fade-in` (the global reduced-motion block
 * already disables it), and `suspend` gives them their own
 * `<Suspense fallback={fallback}>` so a `lazy()` child slots in quietly
 * instead of tripping a route-level skeleton.
 *
 * ```tsx
 * <DeferUntilIdle priority="next-frame" order={1} enter suspend>
 *   <LazyBelowFoldPanel />
 * </DeferUntilIdle>
 * ```
 *
 * @catalog DeferUntilIdle - postpone a heavy or below-fold subtree until idle / next frame, optionally staggered by `order` with a fade-in entrance and its own Suspense for `lazy()` children.
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
  /** Stagger position: waits `order * stepMs` past the threshold. Default 0. */
  order?: number;
  /** Stagger step in ms. Default 60. */
  stepMs?: number;
  /** Wrap the children in a one-shot fade-in when they mount. */
  enter?: boolean;
  /** Give the children their own Suspense boundary (fallback: `fallback`). */
  suspend?: boolean;
  /** Class for the `enter` wrapper (ignored without `enter`). */
  className?: string;
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
  order = 0,
  stepMs = 60,
  enter = false,
  suspend = false,
  className,
}: DeferUntilIdleProps) {
  const staggerMs = Math.max(0, order) * stepMs;
  const [ready, setReady] = useState(immediate || (priority === 'mount-after' && staggerMs === 0));

  useEffect(() => {
    if (ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The threshold fires, then the stagger (if any) runs on a plain timer.
    const fire = () => {
      if (staggerMs > 0) timer = setTimeout(() => setReady(true), staggerMs);
      else setReady(true);
    };
    const clearStagger = () => {
      if (timer !== undefined) clearTimeout(timer);
    };

    if (priority === 'mount-after') {
      fire();
      return clearStagger;
    }

    if (priority === 'next-frame') {
      const id = requestAnimationFrame(fire);
      return () => {
        cancelAnimationFrame(id);
        clearStagger();
      };
    }

    // priority === 'idle'
    // The DOM lib types rIC as always present; the real window may lack it
    // (legacy Safari, jsdom), so it is read through an optional shape.
    const w = window as unknown as IdleApi;
    if (typeof w.requestIdleCallback === 'function' && typeof w.cancelIdleCallback === 'function') {
      const handle = w.requestIdleCallback(fire, { timeout: 500 });
      return () => {
        w.cancelIdleCallback?.(handle);
        clearStagger();
      };
    }
    // Fallback for environments without rIC (Safari, jsdom): use a 0ms
    // timer which always fires in the next macrotask. Less ideal than rIC
    // but consistent and testable.
    const t = setTimeout(fire, 0);
    return () => {
      clearTimeout(t);
      clearStagger();
    };
  }, [priority, ready, staggerMs]);

  if (!ready) return <>{fallback}</>;
  const body = suspend ? <Suspense fallback={fallback}>{children}</Suspense> : children;
  return enter ? <div className={className ? `animate-fade-in ${className}` : 'animate-fade-in'}>{body}</div> : <>{body}</>;
}
