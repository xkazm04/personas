import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * @catalog Generic Kanban board — buckets items into status columns with HTML5 drag-to-move.
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
  /** Tailwind classes for the columns container (default: 3-col grid). */
  columnsClassName?: string;
  /** Column id that catches items whose status matches no column. Defaults to
   *  the first column. */
  fallbackColumnId?: string;
  /** Render a column's empty state (e.g. "drop here" vs "nothing yet"). */
  renderEmptyColumn?: (columnId: string, isDropTarget: boolean) => ReactNode;
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
  columnsClassName = 'grid grid-cols-3 gap-4',
  fallbackColumnId,
  renderEmptyColumn,
}: KanbanBoardProps<T>) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetColumnId, setDropTargetColumnId] = useState<string | null>(null);

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

  const onDrop = (e: DragEvent<HTMLDivElement>, column: KanbanColumn) => {
    e.preventDefault();
    setDropTargetColumnId(null);
    if (!column.targetStatus || !onItemMove) return;
    const id = e.dataTransfer.getData(dragMimeType);
    if (!id) return;
    const item = items.find((it) => getItemId(it) === id);
    if (!item) return;
    if (column.statuses.includes(getItemStatus(item))) return; // already in this column
    void onItemMove(id, column.targetStatus);
  };

  return (
    <div className={columnsClassName}>
      {columns.map((column) => {
        const Icon = column.icon;
        const colItems = byColumn.get(column.id) ?? [];
        const isDropTarget = dropTargetColumnId === column.id;
        const droppable = !!column.targetStatus && !!onItemMove;
        return (
          <div
            key={column.id}
            onDragOver={(e) => onDragOver(e, column.id, droppable)}
            onDragLeave={(e) => onDragLeave(e, column.id)}
            onDrop={(e) => onDrop(e, column)}
            className={[
              'rounded-card border p-3 transition-all',
              column.borderColor ?? 'border-primary/15',
              column.bgColor ?? 'bg-secondary/10',
              isDropTarget ? `ring-2 ${column.ringColor ?? 'ring-primary/40'} scale-[1.005]` : '',
            ].join(' ')}
          >
            <div className="flex items-center gap-2 mb-3">
              {Icon && <Icon className={`w-4 h-4 ${column.iconColor ?? 'text-foreground'}`} />}
              <span className="typo-section-title">{column.label}</span>
              <span className="ml-auto text-[10px] text-foreground bg-primary/10 rounded-full px-1.5 py-0.5 font-medium">
                {colItems.length}
              </span>
            </div>
            <div className="space-y-2 min-h-[80px]">
              {colItems.length === 0
                ? renderEmptyColumn?.(column.id, isDropTarget) ?? null
                : colItems.map((item) => {
                    const id = getItemId(item);
                    return (
                      <div
                        key={id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(dragMimeType, id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDraggingId(id);
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        className={draggingId === id ? 'opacity-40 cursor-grabbing' : 'cursor-grab'}
                      >
                        {renderCard(item, { isDragging: draggingId === id })}
                      </div>
                    );
                  })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default KanbanBoard;
