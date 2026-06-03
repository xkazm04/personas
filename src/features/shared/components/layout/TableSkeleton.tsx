/**
 * @catalog TableSkeleton — grid-shaped shimmer placeholder for a 12-col table (optional header band + N body rows), with per-column bar widths sized to the real columns so the table lands before data and never jumps.
 *
 * Drop it inside the same card container the real table uses (border +
 * rounded-modal + bg-secondary/40) while the first page is in flight, then swap
 * in the real header + rows. Mirror the real `col-span-*` values in `columns`
 * so the swap produces no cumulative layout shift. A compact stacked variant
 * renders below `md` so the loading state isn't blank on mobile.
 *
 * Placeholder bars reuse the `bg-primary/10 animate-pulse` treatment of
 * `ListSkeleton` / `ContentHeaderSkeleton` / `LabResultsSkeleton` so every
 * loading surface reads as one family. (The bars are `bg-primary/10`, not the
 * container's own `bg-secondary/40`, so they stay visible against the card.)
 * **If you restyle the real table grid, nudge the column specs here so the swap
 * stays jump-free.**
 */

export interface TableSkeletonColumn {
  /** Tailwind `col-span-*` class — mirror the real column so the spans sum to 12. */
  span: string;
  /** Placeholder bar width class. Default `'w-full max-w-[5rem]'`. */
  width?: string;
  /** Push the bar to the right edge of the cell (e.g. numeric columns). */
  alignRight?: boolean;
}

interface TableSkeletonProps {
  /** Column geometry — one entry per real grid column. */
  columns: TableSkeletonColumn[];
  /** Number of placeholder body rows. Default 6. */
  rows?: number;
  /** Render the ghost header band above the rows. Default true. */
  header?: boolean;
  /** Vertical padding utility per body row — match the real row density. Default `'py-3'`. */
  rowPaddingY?: string;
  /** Vertical padding utility for the header band — match the real header. Default `'py-2.5'`. */
  headerPaddingY?: string;
  className?: string;
}

// Shared placeholder treatment — matches ListSkeleton / ContentHeaderSkeleton.
const PULSE = 'bg-primary/10 animate-pulse';

export function TableSkeleton({
  columns,
  rows = 6,
  header = true,
  rowPaddingY = 'py-3',
  headerPaddingY = 'py-2.5',
  className,
}: TableSkeletonProps) {
  return (
    <div className={className} aria-hidden="true" data-testid="table-skeleton">
      {/* Desktop grid (md+) — mirrors the real 12-col table */}
      {header && (
        <div className={`hidden md:grid grid-cols-12 gap-4 px-4 ${headerPaddingY} bg-primary/8 border-b border-primary/10`}>
          {columns.map((col, i) => (
            <div key={i} className={`${col.span} flex items-center ${col.alignRight ? 'justify-end' : ''}`}>
              <span className={`h-2.5 w-12 rounded ${PULSE}`} />
            </div>
          ))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className={`hidden md:grid grid-cols-12 gap-4 px-4 ${rowPaddingY} border-b border-primary/10 last:border-b-0`}
        >
          {columns.map((col, i) => (
            <div key={i} className={`${col.span} flex items-center ${col.alignRight ? 'justify-end' : ''}`}>
              <span className={`h-4 rounded-card ${PULSE} ${col.width ?? 'w-full max-w-[5rem]'}`} />
            </div>
          ))}
        </div>
      ))}

      {/* Mobile stacked cards (<md) — keeps the loading state from going blank */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className={`flex md:hidden flex-col gap-2 px-4 ${rowPaddingY} border-b border-primary/10 last:border-b-0`}
        >
          <div className="flex items-center gap-2">
            <span className={`h-5 w-16 rounded-card ${PULSE}`} />
            <span className={`h-3.5 w-12 rounded ${PULSE}`} />
            <span className={`h-3.5 w-16 rounded ${PULSE} ml-auto`} />
          </div>
          <span className={`h-3 w-2/3 rounded ${PULSE}`} />
        </div>
      ))}
    </div>
  );
}
