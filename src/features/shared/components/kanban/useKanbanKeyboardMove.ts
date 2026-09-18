import { useCallback, useState } from 'react';
import type { KanbanColumn } from './KanbanBoard';

export interface KanbanKeyboardStrings {
  /** Announced on pick-up; also the per-card instruction. */
  pickedUp: string;
  /** `{column}` - announced while arrowing between lanes. */
  targeting: string;
  /** `{column}` and `{count}` - announced once the move commits. */
  dropped: string;
  /** Announced when a pick-up is abandoned. */
  cancelled: string;
}

interface KanbanKeyboardMoveArgs {
  columns: KanbanColumn[];
  /** Which lanes accept a drop (same rule the pointer path uses). */
  isDroppable: (column: KanbanColumn) => boolean;
  orientation: 'columns' | 'rows';
  strings: KanbanKeyboardStrings;
  /** Resulting lane size, for the announcement. */
  countIn: (columnId: string) => number;
  onCommit: (itemId: string, targetStatus: string) => void;
  /** True when the item already sits in that lane - committing is a no-op. */
  isAlreadyIn: (itemId: string, column: KanbanColumn) => boolean;
}

export interface KanbanKeyboardMove {
  /** The card currently picked up, if any. */
  grabbedId: string | null;
  /** The lane the pick-up is aimed at. */
  targetColumnId: string | null;
  /** Text for the board's polite live region. */
  announcement: string;
  /** Attach to each card; returns true when the key was consumed. */
  onCardKeyDown: (e: React.KeyboardEvent, itemId: string, columnId: string) => void;
  /** Clear on blur/unmount so a stale pick-up cannot outlive its card. */
  release: () => void;
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/**
 * The keyboard half of a Kanban move: pick up with Enter/Space, walk the lanes
 * with the arrows, drop with Enter/Space, abandon with Escape - and say out
 * loud what happened, because a drop that only changes a count badge is
 * invisible to anyone not watching it.
 *
 * `onItemMove` was always the mutation API; only the pointer could reach it.
 * This reaches the same one, so a board gains keyboard operation without a
 * second code path for what a move means.
 */
export function useKanbanKeyboardMove({
  columns,
  isDroppable,
  orientation,
  strings,
  countIn,
  onCommit,
  isAlreadyIn,
}: KanbanKeyboardMoveArgs): KanbanKeyboardMove {
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [targetColumnId, setTargetColumnId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const release = useCallback(() => {
    setGrabbedId(null);
    setTargetColumnId(null);
  }, []);

  const onCardKeyDown = useCallback(
    (e: React.KeyboardEvent, itemId: string, columnId: string) => {
      const droppable = columns.filter(isDroppable);
      // A board with nowhere to drop is read-only; leave every key alone.
      if (droppable.length === 0) return;

      const commitKey = e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
      const isGrabbed = grabbedId === itemId;

      if (commitKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!isGrabbed) {
          setGrabbedId(itemId);
          // Aim at the card's own lane when it can be dropped back into, else
          // at the first lane that accepts anything.
          const own = columns.find((c) => c.id === columnId);
          setTargetColumnId(own && isDroppable(own) ? own.id : droppable[0]!.id);
          setAnnouncement(strings.pickedUp);
          return;
        }
        const target = columns.find((c) => c.id === targetColumnId);
        release();
        if (!target?.targetStatus) return;
        if (isAlreadyIn(itemId, target)) {
          setAnnouncement(strings.cancelled);
          return;
        }
        onCommit(itemId, target.targetStatus);
        setAnnouncement(
          fill(strings.dropped, { column: target.label, count: countIn(target.id) + 1 }),
        );
        return;
      }

      if (!isGrabbed) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        release();
        setAnnouncement(strings.cancelled);
        return;
      }

      // Only the orientation's own axis moves lanes; the other axis stays with
      // the page, which still has to scroll.
      const forward = orientation === 'rows' ? 'ArrowDown' : 'ArrowRight';
      const backward = orientation === 'rows' ? 'ArrowUp' : 'ArrowLeft';
      if (e.key !== forward && e.key !== backward) return;
      e.preventDefault();
      // Walking the DROPPABLE list is what makes a display-only lane unreachable
      // from the keyboard, exactly as it is unreachable from a pointer.
      const current = droppable.findIndex((c) => c.id === targetColumnId);
      const step = e.key === forward ? 1 : -1;
      const next = droppable[Math.min(Math.max(current + step, 0), droppable.length - 1)];
      if (!next || next.id === targetColumnId) return;
      setTargetColumnId(next.id);
      setAnnouncement(fill(strings.targeting, { column: next.label }));
    },
    [
      columns,
      isDroppable,
      orientation,
      strings,
      grabbedId,
      targetColumnId,
      release,
      onCommit,
      countIn,
      isAlreadyIn,
    ],
  );

  return { grabbedId, targetColumnId, announcement, onCardKeyDown, release };
}
