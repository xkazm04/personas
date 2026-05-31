import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Remember and restore a scroll container's vertical offset across remounts,
 * persona switches, route changes, and in-panel tab switches.
 *
 * Switching personas / routes / tabs normally hard-resets a list to the top —
 * a constant paper-cut when you open a detail and come back. This hook caches
 * `scrollTop` in a module-global Map keyed by the caller-provided `key`
 * (encode route + persona + tab + the filters that define "where you are") and
 * applies a single smart rule:
 *
 *   - **genuinely new context** (key never seen) → jump to the top
 *   - **back / return** (key seen before) → restore the remembered offset
 *
 * The hook returns a **callback ref**. Attach it to the scrolling element. It
 * fires exactly when that element mounts/unmounts — which matters because list
 * scroll containers are usually rendered conditionally (only once data has
 * loaded), so a plain effect would miss the late mount. If the element already
 * owns a `RefObject` (e.g. a virtualizer's `parentRef`), pass it as
 * `forwardRef` and the callback forwards the node into it, so one `ref={...}`
 * drives both the virtualizer and restoration.
 *
 * Restoration is virtualization-aware: it re-applies the saved offset across a
 * short budget of animation frames while the virtual content streams in and
 * grows tall enough to reach the target, then stops.
 *
 * @param key        Context key. `undefined` (or `enabled: false`) makes the
 *                   hook inert — it still forwards the node, so it is safe to
 *                   wire unconditionally into a shared component and only pass a
 *                   key where restoration is wanted.
 * @param forwardRef Optional existing ref to receive the node (composes with a
 *                   virtualizer's `parentRef`).
 */

// Module-global so positions survive component remounts; on globalThis so they
// also survive Vite HMR (mirrors the executionBuffers / eventBus singletons).
const POSITIONS: Map<string, number> =
  ((globalThis as Record<string, unknown>).__personasScrollPositions__ as
    | Map<string, number>
    | undefined) ??
  ((globalThis as Record<string, unknown>).__personasScrollPositions__ = new Map<string, number>());

// Frame budget (~0.66s at 60fps) for re-applying the offset while a virtualized
// list grows to its full height. Most restores land in 1–2 frames.
const MAX_RESTORE_FRAMES = 40;

export function useScrollRestoration<T extends HTMLElement = HTMLElement>(
  key: string | undefined,
  forwardRef?: { current: T | null },
  options?: { enabled?: boolean },
): (node: T | null) => void {
  const enabled = options?.enabled !== false && !!key;

  const elRef = useRef<T | null>(null);
  const keyRef = useRef<string | undefined>(key);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // True while we are programmatically re-applying the offset, so the scroll
  // listener doesn't record our own synthetic scrolls back into the Map.
  const restoringRef = useRef(false);
  const saveRafRef = useRef<number | null>(null);
  const restoreRafRef = useRef<number | null>(null);

  // Throttled save of the *current* key's offset.
  const onScroll = useCallback(() => {
    if (!enabledRef.current || restoringRef.current) return;
    if (saveRafRef.current != null) return;
    saveRafRef.current = requestAnimationFrame(() => {
      saveRafRef.current = null;
      const el = elRef.current;
      const k = keyRef.current;
      if (el && k && !restoringRef.current) POSITIONS.set(k, el.scrollTop);
    });
  }, []);

  const cancelRestore = useCallback(() => {
    if (restoreRafRef.current != null) {
      cancelAnimationFrame(restoreRafRef.current);
      restoreRafRef.current = null;
    }
    restoringRef.current = false;
  }, []);

  // Restore (or jump-to-top) the offset for the current key onto `el`.
  const restore = useCallback(
    (el: T) => {
      cancelRestore();
      const k = keyRef.current;
      if (!enabledRef.current || !k) return;
      const saved = POSITIONS.get(k);
      if (saved === undefined || saved <= 0) {
        // Genuinely new context (or remembered top) → start at the top.
        el.scrollTop = 0;
        return;
      }
      // Returning context → re-apply, retrying across frames while the
      // virtualized content streams in and grows tall enough to reach `saved`.
      restoringRef.current = true;
      let frames = 0;
      const apply = () => {
        const node = elRef.current;
        if (!node || node !== el || keyRef.current !== k || !enabledRef.current) {
          restoringRef.current = false;
          restoreRafRef.current = null;
          return;
        }
        const maxTop = node.scrollHeight - node.clientHeight;
        node.scrollTop = Math.min(saved, Math.max(0, maxTop));
        frames += 1;
        if (maxTop >= saved || frames >= MAX_RESTORE_FRAMES) {
          restoringRef.current = false;
          restoreRafRef.current = null;
          return;
        }
        restoreRafRef.current = requestAnimationFrame(apply);
      };
      apply();
    },
    [cancelRestore],
  );

  // Callback ref: own the element identity + scroll listener. Save the offset
  // on detach, restore it on attach. Stable identity (deps never change at
  // runtime) so React doesn't detach/reattach on every render.
  const setRef = useCallback(
    (node: T | null) => {
      if (forwardRef) forwardRef.current = node;
      const prev = elRef.current;
      if (prev && prev !== node) {
        if (enabledRef.current && keyRef.current && !restoringRef.current) {
          POSITIONS.set(keyRef.current, prev.scrollTop);
        }
        prev.removeEventListener('scroll', onScroll);
        cancelRestore();
      }
      elRef.current = node;
      if (node) {
        node.addEventListener('scroll', onScroll, { passive: true });
        if (enabledRef.current) restore(node);
      }
    },
    [forwardRef, onScroll, restore, cancelRestore],
  );

  // Key change while the element stays mounted: persist the outgoing key's
  // offset, then restore the incoming key's (the callback ref won't re-fire
  // because the DOM node is unchanged). Runs pre-paint to avoid a flicker.
  useLayoutEffect(() => {
    const prevKey = keyRef.current;
    if (prevKey === key) return; // first run, or no actual change
    const el = elRef.current;
    if (el && enabledRef.current && prevKey && !restoringRef.current) {
      POSITIONS.set(prevKey, el.scrollTop);
    }
    keyRef.current = key;
    if (el && enabled) restore(el);
  }, [key, enabled, restore]);

  // Unmount cleanup.
  useEffect(
    () => () => {
      if (saveRafRef.current != null) cancelAnimationFrame(saveRafRef.current);
      cancelRestore();
      const el = elRef.current;
      if (el) el.removeEventListener('scroll', onScroll);
    },
    [onScroll, cancelRestore],
  );

  return setRef;
}

/** Test/maintenance helper — drop a remembered offset (or all of them). */
export function clearScrollRestoration(key?: string): void {
  if (key === undefined) POSITIONS.clear();
  else POSITIONS.delete(key);
}
