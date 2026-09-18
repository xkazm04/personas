import { useCallback, useId, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useKanbanKeyboardMove } from './useKanbanKeyboardMove';

/**
 * @catalog Generic Kanban board — buckets items into status columns, movable by
 * drag OR by keyboard (Enter picks up, arrows choose a lane, Enter drops), with
 * every move announced in a polite live region.
 *
 * Domain-agnostic: the caller supplies columns (each with the statuses it
 * holds + an optional `targetStatus` applied on drop), the items, accessors
 * for id/status, and a `renderCard`. The board owns drag state, drop zones,
 * bucketing, and column chrome; cards stay pure presentational. Columns with
 * no `targetStatus` (or when `onItemMove` is omitted) are display-only lanes —
 * useful for boards whose status is owned by a backend orchestrator and only
 * *some* transitions are user-driven.
 */

export interface KanbanColumn {
  id: string;
  /** Already-resolved label (caller handles i18n). */
  label: string;
  icon?: LucideIcon;
  iconColor?: string;
  borderColor?: string;
  bgColor?: string;
  ringColor?: string;
  /** Item statuses that bucket into this column. */
  statuses: string[];
  /** Status applied when an item is dropped here. Omit to make the column a
   *  display-only (non-drop) lane. */
  targetStatus?: string;
}

export interface KanbanBoardProps<T> {
  columns: KanbanColumn[];
  items: T[];
  getItemId: (item: T) => string;
  getItemStatus: (item: T) => string;
  renderCard: (item: T, state: { isDragging: boolean }) => ReactNode;
  /** Fires when a card is dropped into a column whose `targetStatus` differs
   *  from the item's current bucket. Omit for a read-only board. */
  onItemMove?: (itemId: string, targetStatus: string) => void | Promise<void>;
  /** Drag MIME — keep distinct per board type so cross-board drops are inert. */
  dragMimeType?: string;
  /** Lane orientation. `columns` (default) lays lanes out horizontally with
   *  the header on top and cards stacked beneath — the classic board. `rows`
   *  transposes it: lanes stack vertically (1 column, N rows) with each lane's
   *  header on the left and its cards flowing horizontally. Use `rows` in
   *  narrow containers (e.g. a split-pane right rail) where 5 grid columns
   *  would be unreadably cramped. */
  orientation?: 'columns' | 'rows';
  /** Tailwind classes for the lanes container. Defaults to a 3-col grid in
   *  `columns` orientation, or a vertical stack in `rows` orientation. */
  columnsClassName?: string;
  /** Column id that catches items whose status matches no column. Defaults to
   *  the first column. */
  fallbackColumnId?: string;
  /** Render a column's empty state (e.g. "drop here" vs "nothing yet"). */
  renderEmptyColumn?: (columnId: string, isDropTarget: boolean) => ReactNode;
  /** Accessible name for the board as a whole (already translated). */
  ariaLabel?: string;
}

const DEFAULT_MIME = 'application/x-personas-kanban-id';

export function KanbanBoard<T>({
  columns,
  items,
  getItemId,
  getItemStatus,
  renderCard,
  onItemMove,
  dragMimeType = DEFAULT_MIME,
  orientation = 'columns',
  columnsClassName,
  fallbackColumnId,
  renderEmptyColumn,
  ariaLabel,
}: KanbanBoardProps<T>) {
  const { t } = useTranslation();
  const hintId = useId();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetColumnId, setDropTargetColumnId] = useState<string | null>(null);

  const rows = orientation === 'rows';
  const containerClass =
    columnsClassName ?? (rows ? 'flex flex-col gap-2' : 'grid grid-cols-3 gap-4');

  const fallback = fallbackColumnId ?? columns[0]?.id;

  const byColumn = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const c of columns) map.set(c.id, []);
    for (const item of items) {
      const status = getItemStatus(item);
      const col = columns.find((c) => c.statuses.includes(status));
      const targetId = col?.id ?? fallback;
      if (targetId && map.has(targetId)) map.get(targetId)!.push(item);
    }
    return map;
  }, [columns, items, getItemStatus, fallback]);

  const onDragOver = (e: DragEvent<HTMLDivElement>, columnId: string, droppable: boolean) => {
    if (!droppable || !e.dataTransfer.types.includes(dragMimeType)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetColumnId !== columnId) setDropTargetColumnId(columnId);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>, columnId: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (dropTargetColumnId === columnId) setDropTargetColumnId(null);
  };

  const isDroppable = useCallback(
    (column: KanbanColumn) => !!column.targetStatus && !!onItemMove,
    [onItemMove],
  );

  const keyboard = useKanbanKeyboardMove({
    columns,
    isDroppable,
    orientation,
    strings: {
      pickedUp: t.shared.kanban.picked_up,
      targeting: t.shared.kanban.targeting,
      dropped: t.shared.kanban.dropped,
      cancelled: t.shared.kanban.cancelled,
    },
    countIn: useCallback((columnId: string) => byColumn.get(columnId)?.length ?? 0, [byColumn]),
    onCommit: useCallback(
      (itemId: string, targetStatus: string) => void onItemMove?.(itemId, targetStatus),
      [onItemMove],
    ),
    isAlreadyIn: useCallback(
      (itemId: string, column: KanbanColumn) => {
        const item = items.find((it) => getItemId(it) === itemId);
        return !!item && column.statuses.includes(getItemStatus(item));
      },
      [items, getItemId, getItemStatus],
    ),
  });

  const onDrop = (e: DragEvent<HTMLDivElement>, column: KanbanColumn) => {
    e.preventDefault();
    setDropTargetColumnId(null);
    // Clear the drag state here, not just in onDragEnd: when the drop moves
    // the card to another column, the original element unmounts before its
    // native `dragend` fires, so onDragEnd never runs and the moved card
    // would stay stuck at opacity-40 (it kept matching draggingId).
    setDraggingId(null);
    if (!column.targetStatus || !onItemMove) return;
    const id = e.dataTransfer.getData(dragMimeType);
    if (!id) return;
    const item = items.find((it) => getItemId(it) === id);
    if (!item) return;
    if (column.statuses.includes(getItemStatus(item))) return; // already in this column
    void onItemMove(id, column.targetStatus);
  };

  return (
    <div role="group" aria-label={ariaLabel} className={containerClass}>
      {/* One polite region for the whole board: a drop that only changes a
          count badge is otherwise invisible to anyone not watching it. */}
      <div role="status" aria-live="polite" className="sr-only">
        {keyboard.announcement}
      </div>
      {columns.map((column) => {
        const Icon = column.icon;
        const colItems = byColumn.get(column.id) ?? [];
        const droppable = isDroppable(column);
        const isDropTarget =
          dropTargetColumnId === column.id ||
          (!!keyboard.grabbedId && keyboard.targetColumnId === column.id);
        const header = (
          <div className={rows ? 'flex items-center gap-2 w-32 flex-shrink-0' : 'flex items-center gap-2 mb-3'}>
            {Icon && <Icon className={`w-4 h-4 flex-shrink-0 ${column.iconColor ?? 'text-foreground'}`} />}
            <span className="typo-section-title truncate">{column.label}</span>
            <span className="ml-auto text-[10px] text-foreground bg-primary/10 rounded-full px-1.5 py-0.5 font-medium">
              {colItems.length}
            </span>
          </div>
        );
        const cards =
          colItems.length === 0
            ? renderEmptyColumn?.(column.id, isDropTarget) ?? null
            : colItems.map((item) => {
                const id = getItemId(item);
                return (
                  <div
                    key={id}
                    draggable
                    // Focusable so the card can be picked up without a pointer.
                    // `aria-roledescription` is what tells a screen reader this
                    // is movable; the hint names the keys.
                    tabIndex={0}
                    aria-roledescription={t.shared.kanban.card_roledescription}
                    aria-describedby={hintId}
                    onKeyDown={(e) => keyboard.onCardKeyDown(e, id, column.id)}
                    onBlur={() => {
                      if (keyboard.grabbedId === id) keyboard.release();
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(dragMimeType, id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggingId(id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    className={`focus-ring rounded-card ${
                      draggingId === id || keyboard.grabbedId === id
                        ? 'opacity-40 cursor-grabbing'
                        : 'cursor-grab'
                    }`}
                  >
                    {renderCard(item, { isDragging: draggingId === id })}
                  </div>
                );
              });
        return (
          <div
            key={column.id}
            onDragOver={(e) => onDragOver(e, column.id, droppable)}
            onDragLeave={(e) => onDragLeave(e, column.id)}
            onDrop={(e) => onDrop(e, column)}
            className={[
              'rounded-card border p-3 transition-all',
              rows ? 'flex items-start gap-3' : '',
              column.borderColor ?? 'border-primary/15',
              column.bgColor ?? 'bg-secondary/10',
              isDropTarget ? `ring-2 ${column.ringColor ?? 'ring-primary/40'} scale-[1.005]` : '',
            ].join(' ')}
          >
            {header}
            <div className={rows ? 'flex-1 flex flex-wrap gap-2 content-start min-h-[2rem]' : 'space-y-2 min-h-[80px]'}>
              {cards}
            </div>
          </div>
        );
      })}
      <span id={hintId} hidden>
        {t.shared.kanban.picked_up}
      </span>
    </div>
  );
}

export default KanbanBoard;
