/**
 * UnifiedTableRow: one memoized body row of `UnifiedTable` (flow, virtual and
 * grouped layouts). Internal to UnifiedTable; not a catalog primitive.
 *
 * Why it exists: the table used to render every row inline with a fresh
 * `onClick` closure, a fresh entrance object and the row's index, so any table
 * render (a poll, a selection or focus move, a parent re-render) re-rendered
 * every mounted row. A row now re-renders only when something it shows changed.
 *
 * The equality ({@link rowPropsEqual}) and why each term is safe:
 * - Identity and wiring: `columns`, `gridTemplate`, `onRowClick`, `onRevealEnd`
 *   by reference. The table hands in ref-held stable callbacks, so these change
 *   only when the caller changes its columns (a new render closure means new
 *   output, so every row must re-render then). A caller that rebuilds
 *   `columns` every render gets the old behaviour, never a stale row.
 * - The row's own presentation: key, accent class, focus, clickable, entrance
 *   delay, padding and virtual placement, all primitives.
 * - Position: only what position actually paints, the stripe parity and the
 *   top border (`index % 2`, `index > 0`). The raw index is compared only when
 *   a column's `render` declares the index parameter (`render.length > 1`),
 *   because only then can a cell's output depend on it. So a sibling inserted
 *   two rows above leaves this row alone unless a cell reads its index.
 * - Data: the same row object, or a plain object with the same own keys whose
 *   values are `Object.is`-equal (a poll that re-fetches unchanged records
 *   produces fresh but equal objects). A nested object that changed is a new
 *   reference, so it fails the shallow check and the row re-renders.
 *
 * What memoization cannot see: a cell that reads state OUTSIDE its props or
 * the columns' closures (a store's `getState()` in `render`, a module variable,
 * a clock). Such a cell stays as it was until its row changes; keep that state
 * inside a component that subscribes to it (e.g. `display/RelativeTime` for
 * "ago" text), not in the render function.
 */
import { memo, useCallback, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactElement } from 'react';
import type { TableColumn } from './UnifiedTable';

export interface UnifiedTableRowProps<T> {
  row: T;
  rowKey: string;
  /** Position in the displayed (sorted) data. */
  index: number;
  columns: TableColumn<T>[];
  gridTemplate: string;
  /** True when some column's `render` declares the index parameter. */
  indexSensitive: boolean;
  /** Stable across table renders (ref-held by the table). */
  onRowClick: (row: T) => void;
  clickable: boolean;
  accent: string | undefined;
  focused: boolean;
  /** Entrance stagger in ms, or null when the row renders plainly. */
  revealDelayMs: number | null;
  /** Stable; records that this row's entrance finished. */
  onRevealEnd: (rowKey: string) => void;
  /** Flow-layout vertical padding class; ignored in virtual placement. */
  padY: string;
  /** Virtual placement (absolute + translateY). Omit for the flow layout. */
  virtualStart?: number;
  virtualSize?: number;
}

function shallowEqualPlain(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(rb, k) || !Object.is(ra[k], rb[k])) return false;
  }
  return true;
}

/** Exported for the unit test that pins the contract described in the header. */
export function rowPropsEqual<T>(a: UnifiedTableRowProps<T>, b: UnifiedTableRowProps<T>): boolean {
  if (
    a.columns !== b.columns ||
    a.gridTemplate !== b.gridTemplate ||
    a.onRowClick !== b.onRowClick ||
    a.onRevealEnd !== b.onRevealEnd ||
    a.indexSensitive !== b.indexSensitive
  ) return false;
  if (
    a.rowKey !== b.rowKey ||
    a.clickable !== b.clickable ||
    a.accent !== b.accent ||
    a.focused !== b.focused ||
    a.revealDelayMs !== b.revealDelayMs ||
    a.padY !== b.padY ||
    a.virtualStart !== b.virtualStart ||
    a.virtualSize !== b.virtualSize
  ) return false;
  if (a.index % 2 !== b.index % 2 || a.index > 0 !== b.index > 0) return false;
  if (b.indexSensitive && a.index !== b.index) return false;
  return a.row === b.row || shallowEqualPlain(a.row, b.row);
}

function UnifiedTableRowImpl<T>({
  row, rowKey, index, columns, gridTemplate, onRowClick, clickable, accent, focused,
  revealDelayMs, onRevealEnd, padY, virtualStart, virtualSize,
}: UnifiedTableRowProps<T>) {
  const virtual = virtualStart !== undefined;
  const entering = revealDelayMs !== null;
  const style: CSSProperties = {
    ...(virtual
      ? { position: 'absolute', top: 0, transform: `translateY(${virtualStart}px)`, width: '100%', height: `${virtualSize}px` }
      : null),
    gridTemplateColumns: gridTemplate,
    contain: 'layout paint style',
    ...(entering ? { animationDelay: `${revealDelayMs}ms` } : null),
  };
  return (
    <div
      onClick={() => onRowClick(row)}
      onAnimationEnd={entering ? (e) => {
        // Only our own fade, never a CSS animation bubbling up from a cell.
        if (e.target === e.currentTarget) onRevealEnd(rowKey);
      } : undefined}
      style={style}
      className={`row-hover-lift grid items-center ${virtual ? '' : `px-0 ${padY}`} border-l-2 ${accent ?? 'border-transparent'} hover:bg-primary/[0.12] ${focused ? 'ring-1 ring-inset ring-primary/40 z-[1]' : ''} ${clickable ? 'cursor-pointer' : ''} ${index > 0 ? 'border-t border-t-primary/10' : ''} ${index % 2 === 0 ? 'bg-primary/[0.03]' : ''} ${entering ? 'animate-fade-in' : ''}`}
    >
      {columns.map((col) => (
        <div key={col.key} className={`px-4 min-w-0 ${col.align === 'right' ? 'text-right' : ''}`}>
          {col.render(row, index)}
        </div>
      ))}
    </div>
  );
}

// `memo` erases the component's type parameter; the cast restores the generic
// call signature. It is type-only: the runtime value is exactly memo's result.
export const UnifiedTableRow = memo(UnifiedTableRowImpl, rowPropsEqual) as <T>(
  props: UnifiedTableRowProps<T> & { key?: string },
) => ReactElement;

/**
 * A row-click handler whose identity never changes, forwarding to the latest
 * `onRowClick`. Callers routinely pass an inline arrow; holding it in a ref
 * keeps the memoized rows equal across renders (a new function per render
 * would fail every row's comparison and re-render the whole body).
 */
export function useStableRowClick<T>(onRowClick: ((row: T) => void) | undefined): (row: T) => void {
  const ref = useRef(onRowClick);
  useLayoutEffect(() => {
    ref.current = onRowClick;
  });
  return useCallback((row: T) => ref.current?.(row), []);
}

/** True when some column's `render` declares the index parameter. */
export function useIndexSensitive<T>(columns: TableColumn<T>[]): boolean {
  return useMemo(() => columns.some((c) => c.render.length > 1), [columns]);
}
