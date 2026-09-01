// useRailWidth — the Activity rail's width, dragged and remembered.
//
// The rail was a fixed 320px, which is the right floor and the wrong ceiling.
// It is a column of titles: at 320 a review title truncates inside its first
// clause on a 34" display with eight hundred spare pixels sitting to the left
// of it. The floor stays (below ~280 the two-line row stops working), the
// ceiling becomes the operator's.
//
// Three things here are not free choices — the census rejected the obvious
// version of each, and `docs/concepts/golden-paths/scroll-and-resize-affordances.md`
// §(d) and `client-state-persistence.md` prescribe what replaced it:
//
// 1. THE WIDTH IS A MODULE STORE READ THROUGH `useSyncExternalStore`, not a
//    `useState(loadWidth)`. A mount-time snapshot of a durable value gives the
//    component a private copy that no later write can reach, and the next
//    commit built from the stale copy serializes it back over the fresh one
//    (census: `mount-snapshot-of-durable-state`). There is one rail today, so
//    the two-writer race is hypothetical — but the fix costs eight lines and
//    "hypothetical" is what every one of those thirteen sites said first.
//
// 2. WRITES GO THROUGH `createThrottledLocalStorage`, the repo's own door, not
//    through `localStorage` directly (census: `raw-web-storage`). It coalesces
//    a drag's hundreds of writes into one, flushes on `pagehide`, and swallows
//    the throw that a private window or a blocked-site-data setting produces —
//    all three of which this hook would otherwise have had to hand-roll, and
//    the third of which would take down the Monitor overlay to fail at
//    remembering a number.
//
// 3. THE DRAG IS SCOPED TO THE HANDLE with `setPointerCapture`, not to
//    `document` (census: `document-scoped-drag-loop`). The browser then routes
//    every move to that element and tears the capture down on
//    `lostpointercapture`, so an interrupted drag — the Monitor closing
//    mid-gesture, which Escape makes reachable — cannot strand a listener, and
//    there is no `document.body.style` to restore.
//
// It is per-machine on purpose: the same account on a laptop and on a 34" panel
// wants two different numbers, and a synced value would fight itself.

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { createThrottledLocalStorage } from '@/lib/throttledStorage';

const STORAGE_KEY = 'activity-rail-width';

/** Below this the two-line row stops working: the title has no room to be a
 *  title, which is the one thing the row exists to show. */
export const RAIL_MIN_WIDTH = 280;
/** Past this the rail stops being a rail and starts being the view. The board
 *  is the subject; this is the margin. */
export const RAIL_MAX_WIDTH = 720;
/** What it always was, and still is until someone drags it. */
export const RAIL_DEFAULT_WIDTH = 320;

function clamp(px: number): number {
  return Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, Math.round(px)));
}

// ---------------------------------------------------------------------------
// The store. Module-scoped because the width is ONE value for the app, not one
// per component that happens to render a handle.
// ---------------------------------------------------------------------------

const storage = createThrottledLocalStorage();

function readStored(): number {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return RAIL_DEFAULT_WIDTH;
  const n = Number(raw);
  // A stored value that is not a number came from some other version of this
  // app or a hand-edited profile. Clamping NaN would give NaN, and a NaN width
  // renders the rail at zero with no error anywhere.
  return Number.isFinite(n) ? clamp(n) : RAIL_DEFAULT_WIDTH;
}

let current = readStored();
const listeners = new Set<() => void>();

/** `useSyncExternalStore` requires a stable identity per unchanged value — this
 *  returns a number, so equality is value equality and there is nothing to
 *  cache. */
function getSnapshot(): number {
  return current;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function writeWidth(px: number): void {
  const next = clamp(px);
  if (next === current) return;
  current = next;
  // Throttled: a 300px drag is ~300 pointermove events, and a synchronous
  // localStorage write per frame is a main-thread stall you can feel in the
  // drag itself. The door coalesces them and flushes on pagehide.
  storage.setItem(STORAGE_KEY, String(next));
  for (const listener of listeners) listener();
}

/** Test hook — the module store outlives a test file otherwise. */
export function _resetRailWidthForTests(): void {
  current = RAIL_DEFAULT_WIDTH;
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------

export interface RailWidth {
  width: number;
  dragging: boolean;
  /** Spread onto the handle element. Includes the ARIA a splitter owes. */
  handleProps: {
    role: 'separator';
    'aria-orientation': 'vertical';
    'aria-valuenow': number;
    'aria-valuemin': number;
    'aria-valuemax': number;
    tabIndex: number;
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onLostPointerCapture: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onDoubleClick: () => void;
  };
}

/** Step per arrow press. Big enough to be worth a keystroke, small enough to
 *  land on a width you meant. Shift multiplies it. */
const KEY_STEP = 16;

export function useRailWidth(): RailWidth {
  const width = useSyncExternalStore(subscribe, getSnapshot);
  const [dragging, setDragging] = useState(false);
  // The gesture's origin. A ref would do; state would re-render every move.
  const [origin, setOrigin] = useState<{ x: number; width: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setOrigin({ x: e.clientX, width: current });
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!origin) return;
      // The rail is on the RIGHT, so dragging LEFT (a negative delta) makes it
      // wider. Getting this sign backwards is the classic version of this bug
      // and it is invisible until someone actually drags.
      writeWidth(origin.width - (e.clientX - origin.x));
    },
    [origin],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    // Releasing capture fires `lostpointercapture`, which clears the rest.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // The one teardown, and it runs for EVERY way a drag can end — release, a
  // cancelled gesture, the element unmounting mid-drag. That is the property
  // pointer capture is here for.
  const onLostPointerCapture = useCallback(() => {
    setOrigin(null);
    setDragging(false);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = current + step;
    else if (e.key === 'ArrowRight') next = current - step;
    else if (e.key === 'Home') next = RAIL_DEFAULT_WIDTH;
    if (next === null) return;
    e.preventDefault();
    // Escape closes the Monitor; a resize keystroke must not also reach it.
    e.stopPropagation();
    writeWidth(next);
  }, []);

  const reset = useCallback(() => writeWidth(RAIL_DEFAULT_WIDTH), []);

  const handleProps = useMemo(
    () => ({
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-valuenow': width,
      'aria-valuemin': RAIL_MIN_WIDTH,
      'aria-valuemax': RAIL_MAX_WIDTH,
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onLostPointerCapture,
      onKeyDown,
      onDoubleClick: reset,
    }),
    [width, onPointerDown, onPointerMove, endDrag, onLostPointerCapture, onKeyDown, reset],
  );

  return { width, dragging, handleProps };
}
