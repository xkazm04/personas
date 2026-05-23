import { ArrowUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export type SortDirection = 'asc' | 'desc';

export interface SortableHeaderProps {
  /** Visible, already-translated column label. */
  label: string;
  /** Whether this column is the currently active sort column. */
  active: boolean;
  /** Current sort direction. Only meaningful while `active`. */
  dir: SortDirection;
  /** Invoked when the user toggles the sort on this column. */
  onSort: () => void;
  /** Content alignment. Defaults to `'left'`. */
  align?: 'left' | 'right';
  /**
   * Wrapper element. `'th'` (default) for real `<table>`s — its implicit
   * `columnheader` role carries the `aria-sort` state. `'div'` for CSS-grid
   * faux tables, where we attach an explicit `role="columnheader"` so assistive
   * tech still reads the sort state.
   */
  as?: 'th' | 'div';
  /**
   * Padding classes for the wrapper element. Defaults to `'px-4 py-2.5'`.
   * Pass density-aware padding (e.g. `'px-4 py-1.5'`) to override — supplying
   * the whole string avoids Tailwind class-conflict ambiguity.
   */
  padding?: string;
  /** Extra classes for the wrapper element (appended after padding/alignment). */
  className?: string;
  /** Extra classes for the inner `<button>`. */
  buttonClassName?: string;
}

/**
 * Accessible, animated sortable column header.
 *
 * - Emits `aria-sort` (`ascending` / `descending` / `none`) on the column-header
 *   element so screen-reader users can perceive the sort state.
 * - Gives the button a descriptive `aria-label` ("Sort by X" / "Sorted by X,
 *   ascending. Activate to sort descending.") instead of a bare icon.
 * - `focus-ring` for keyboard-visible focus.
 * - The direction caret rotates (asc ↔ desc) and fades (active ↔ idle) over
 *   150ms instead of an instant icon swap. The global reduced-motion CSS reset
 *   (Layer 2, `src/styles/globals.css`) collapses this transition to ~0 for
 *   users who request it, so no per-component gate is needed.
 *
 * Usage:
 * ```tsx
 * <SortableHeader
 *   label={t.deployment.dashboard.col_name}
 *   active={sortKey === 'name'}
 *   dir={sortDir}
 *   onSort={() => toggleSort('name')}
 * />
 * ```
 */
export function SortableHeader({
  label,
  active,
  dir,
  onSort,
  align = 'left',
  as = 'th',
  padding = 'px-4 py-2.5',
  className = '',
  buttonClassName = '',
}: SortableHeaderProps) {
  const { t, tx } = useTranslation();

  const ariaSort: 'ascending' | 'descending' | 'none' = active
    ? dir === 'asc' ? 'ascending' : 'descending'
    : 'none';

  const ariaLabel = active
    ? dir === 'asc'
      ? tx(t.shared.sort_active_asc, { label })
      : tx(t.shared.sort_active_desc, { label })
    : tx(t.shared.sort_by, { label });

  // The button carries the padding and fills the cell so the whole header is a
  // single, keyboard-reachable click target (matching the old full-cell click).
  const button = (
    <button
      type="button"
      onClick={onSort}
      aria-label={ariaLabel}
      className={`group flex items-center gap-1 w-full h-full ${padding} typo-label text-foreground transition-colors hover:text-muted-foreground/90 focus-ring rounded-card select-none ${
        align === 'right' ? 'justify-end' : 'justify-start'
      } ${buttonClassName}`}
    >
      {label}
      <ArrowUp
        aria-hidden="true"
        className={`w-3 h-3 shrink-0 transition-[transform,opacity,color] duration-150 ease-out ${
          active
            ? `opacity-100 text-primary ${dir === 'desc' ? 'rotate-180' : 'rotate-0'}`
            : 'opacity-0 text-foreground rotate-0 group-hover:opacity-40'
        }`}
      />
    </button>
  );

  // The column-header element carries `aria-sort`: `<th>` has an implicit
  // `columnheader` role; the grid `<div>` gets an explicit one.
  if (as === 'div') {
    return (
      <div role="columnheader" aria-sort={ariaSort} className={`flex ${className}`}>
        {button}
      </div>
    );
  }

  return (
    <th aria-sort={ariaSort} className={`p-0 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      {button}
    </th>
  );
}
