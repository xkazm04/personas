/**
 * ColumnResize — shared primitives for user-resizable table columns.
 *
 * `useColumnWidths` keeps a per-table map of px-width overrides (persisted to
 * localStorage), and `ColumnResizeHandle` is the draggable divider rendered on
 * the right edge of a column header. Unresized columns keep their original
 * (often flexible `minmax(..,1fr)`) width; once a column is dragged it becomes
 * a fixed px width so the customization sticks.
 *
 * Used by UnifiedTable (Events) and the custom grid tables in Activity and
 * Messages — see `template()` for how a grid-template string is composed.
 */
import { useCallback, useRef, useState } from 'react';
import { createLogger } from '@/lib/log';

const logger = createLogger('column-resize');

/** Columns can never be dragged narrower than this. */
const MIN_COLUMN_WIDTH = 64;
const STORAGE_PREFIX = 'table-col-widths:';

export interface ColumnWidthsApi {
  /** px overrides keyed by column key; an absent key means "use the default width". */
  widths: Record<string, number>;
  /** Build a CSS grid-template-columns value for the given ordered columns. */
  template: (columns: { key: string; width: string }[]) => string;
  /** Start a pointer-drag resize for `key`, given the column's current px width. */
  beginResize: (key: string, startWidth: number, clientX: number) => void;
  /** Drop the override for one column (double-click the handle to restore default). */
  clearColumn: (key: string) => void;
  /** True while a drag-resize is in progress. */
  isResizing: boolean;
}

/**
 * Per-table column-width state. `tableId` namespaces the localStorage entry so
 * each table remembers its own layout independently.
 */
export function useColumnWidths(tableId: string): ColumnWidthsApi {
  const storageKey = STORAGE_PREFIX + tableId;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
    } catch (err) {
      logger.warn('Failed to read persisted column widths', { error: err });
      return {};
    }
  });
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ key: string; startWidth: number; startX: number; moved: boolean } | null>(null);

  const persist = useCallback((next: Record<string, number>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (err) {
      logger.warn('Failed to persist column widths', { error: err });
    }
  }, [storageKey]);

  const beginResize = useCallback((key: string, startWidth: number, clientX: number) => {
    dragRef.current = { key, startWidth, startX: clientX, moved: false };
    setIsResizing(true);

    const handleMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      // Ignore sub-threshold jitter so a plain click (vs. a deliberate drag)
      // never freezes the column at its current width.
      if (!drag.moved && Math.abs(delta) < 3) return;
      drag.moved = true;
      const next = Math.max(MIN_COLUMN_WIDTH, Math.round(drag.startWidth + delta));
      setWidths((prev) => (prev[drag.key] === next ? prev : { ...prev, [drag.key]: next }));
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      const moved = dragRef.current?.moved ?? false;
      dragRef.current = null;
      setIsResizing(false);
      // Persist the final layout only if an actual drag occurred.
      if (moved) setWidths((prev) => { persist(prev); return prev; });
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [persist]);

  const clearColumn = useCallback((key: string) => {
    setWidths((prev) => {
      if (prev[key] == null) return prev;
      const next = { ...prev };
      delete next[key];
      persist(next);
      return next;
    });
  }, [persist]);

  const template = useCallback(
    (columns: { key: string; width: string }[]) =>
      columns.map((c) => (widths[c.key] != null ? `${widths[c.key]}px` : c.width)).join(' '),
    [widths],
  );

  return { widths, template, beginResize, clearColumn, isResizing };
}

interface ColumnResizeHandleProps {
  /** Called on drag start with the host header cell's current px width. */
  onBeginResize: (startWidth: number, clientX: number) => void;
  /** Called on double-click to restore the default width. */
  onReset: () => void;
  /** Accessible label for the divider, e.g. "Resize Persona column". */
  label: string;
}

/**
 * Draggable column divider. Render as the last child of a `position: relative`
 * header cell — it pins itself to the cell's right edge. Pointer events are
 * stopped so a drag never triggers the header's sort/filter affordances.
 */
export function ColumnResizeHandle({ onBeginResize, onReset, label }: ColumnResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const cell = e.currentTarget.parentElement;
        const width = cell ? cell.getBoundingClientRect().width : 0;
        onBeginResize(width, e.clientX);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onReset(); }}
      onClick={(e) => e.stopPropagation()}
      className="group/resize absolute right-0 top-0 bottom-0 z-20 flex w-2 cursor-col-resize items-stretch justify-center"
    >
      <span className="w-px bg-primary/10 transition-colors group-hover/resize:bg-primary/50" />
    </div>
  );
}
