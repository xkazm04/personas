/**
 * The row-as-canvas interaction primitives: the drag contract, the drop target,
 * the keyboard door to the context menu, and how a milestone's cut state reads
 * as colour. Pure wiring, no layout - all three variants share it.
 */
import { useCallback, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';

import { STATUS_PALETTE, type StatusToken } from '@/lib/design/statusTokens';

/**
 * Drag MIME for a goal being re-bound to a milestone.
 *
 * DISTINCT from `KanbanBoard`'s `application/x-personas-kanban-id` on purpose:
 * that one carries "move this item to a status", this one carries "bind this
 * goal to that cut". A drop of one onto the other is inert because the target
 * checks `dataTransfer.types.includes(MIME)` before it ever calls
 * `preventDefault`, so the browser refuses the drop rather than the handler
 * silently mis-reading the payload.
 */
export const GOAL_BIND_MIME = 'application/x-personas-goal-bind';

/** The keys that mean "open the context menu" on every desktop OS. */
export function isMenuKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean {
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}

const ECHO_WINDOW_MS = 400;

/**
 * Keyboard parity for a right-click menu. A key press re-enters through the
 * SAME door the pointer uses: it dispatches a real `contextmenu` event at the
 * element's own box, so there is one handler and not two code paths for what
 * the menu means. Chromium also fires a trusted `contextmenu` for the Menu key
 * on its own; the echo window swallows that second one.
 *
 * It was first written as `browser/servers/variants/rack/useMenuKey`, which
 * said of itself "LOCAL, not shared ... the Director promotes it". That file is
 * being DELETED in a parallel change (the Server-control variant contest picked
 * its winner), so this is now the only copy, and it belongs in
 * `shared/components/overlays` beside `ContextMenu`. It is not put there here
 * because this change may not touch shared components.
 */
export function useMenuKey(onMenu: (e: MouseEvent) => void) {
  const keyedAt = useRef(0);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    // The guard accepts a bubbled press from a DESCENDANT, unlike the rack
    // copy. Here the focusable element is the goal's own button and the menu
    // host is the wrapper that carries the drag contract, so an identity check
    // on `currentTarget` would make the keyboard route unreachable - which is
    // the exact defect this hook exists to prevent.
    if (!isMenuKey(e) || !e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    const el = e.currentTarget;
    const box = el.getBoundingClientRect();
    keyedAt.current = performance.now();
    el.dispatchEvent(
      new window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + Math.min(box.width / 2, 160),
        clientY: box.top + box.height / 2,
      }),
    );
  }, []);

  const onContextMenu = useCallback(
    (e: MouseEvent) => {
      const echo = e.nativeEvent.isTrusted && performance.now() - keyedAt.current < ECHO_WINDOW_MS;
      if (echo) {
        e.preventDefault();
        return;
      }
      onMenu(e);
    },
    [onMenu],
  );

  return { onKeyDown, onContextMenu };
}

export interface GoalDragState {
  /** The goal currently being dragged, if any. */
  draggingId: string | null;
  onDragStart: (e: DragEvent, goalId: string) => void;
  onDragEnd: () => void;
}

export function useGoalDrag(): GoalDragState {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  return {
    draggingId,
    onDragStart: useCallback((e: DragEvent, goalId: string) => {
      e.dataTransfer.setData(GOAL_BIND_MIME, goalId);
      e.dataTransfer.effectAllowed = 'move';
      setDraggingId(goalId);
    }, []),
    onDragEnd: useCallback(() => setDraggingId(null), []),
  };
}

export interface LaneDrop {
  /** The lane key currently under the pointer, for the drop-target ring. */
  overKey: string | null;
  /** Spread onto a lane. `laneKey` is any stable string; `null` = unassigned. */
  propsFor: (laneKey: string, milestoneId: string | null) => {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

/**
 * The drop half. `onBind` receives the dragged goal and the milestone it landed
 * on (`null` for the unassigned lane), which is exactly the canvas's one
 * mutation - the lane does not know that a move is a remove plus an upsert.
 */
export function useLaneDrop(onBind: (goalId: string, milestoneId: string | null) => void): LaneDrop {
  const [overKey, setOverKey] = useState<string | null>(null);

  const propsFor = useCallback(
    (laneKey: string, milestoneId: string | null) => ({
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(GOAL_BIND_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOverKey((prev) => (prev === laneKey ? prev : laneKey));
      },
      onDragLeave: (e: DragEvent) => {
        if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
        setOverKey((prev) => (prev === laneKey ? null : prev));
      },
      onDrop: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(GOAL_BIND_MIME)) return;
        e.preventDefault();
        setOverKey(null);
        const goalId = e.dataTransfer.getData(GOAL_BIND_MIME);
        if (goalId) onBind(goalId, milestoneId);
      },
    }),
    [onBind],
  );

  return { overKey, propsFor };
}

/**
 * A milestone's colour comes from its CUT STATE, not from its position in a
 * list. Lane identity is carried by the name; a categorical hue per lane would
 * mean a project's third milestone changes colour when its second is deleted,
 * and would say nothing. Shipped reads success, an active cut reads info-blue
 * (the "in your hands" tone), a planned one stays neutral.
 */
export function laneTone(status: string): StatusToken {
  if (status === 'shipped') return STATUS_PALETTE.success;
  if (status === 'active') return STATUS_PALETTE.info;
  return STATUS_PALETTE.neutral;
}
