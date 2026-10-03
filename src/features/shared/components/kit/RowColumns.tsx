import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import { cx } from './types';

/**
 * One declared column of a `Rows` list (grow-4, part 2). The list declares the set ONCE; every row
 * reads it, so the columns line up down the list the way a table's do.
 */
export interface RowColumn {
  /** The column's head. A list with any head draws a head line over its rows. */
  head?: ReactNode;
  /**
   * The column's grid track. It must be a FIXED length or an `fr` - each row is its own grid, so
   * only a track that does not depend on content can line up with the row above it. Default `8rem`.
   */
  width?: string;
  /** `end` right-aligns the cell and its head: the figure column's alignment. */
  align?: 'start' | 'end';
  /** Dropped - cell, head and track - when the LIST is narrow, as `.k-grp` drops its figures. */
  collapse?: boolean;
}

/** The track a column takes when it does not declare one: fixed, so rows line up. */
const DEFAULT_TRACK = '8rem';

const RowColumnsContext = createContext<readonly RowColumn[] | null>(null);

/** The columns the enclosing `Rows` declared, or null on a list that declared none. */
export function useRowColumns(): readonly RowColumn[] | null {
  return useContext(RowColumnsContext);
}

/** The row grid: the name takes the rest, each column its declared track, the trail its content. */
function tracks(columns: readonly RowColumn[], narrow: boolean): string {
  const cols = columns.filter((c) => !narrow || !c.collapse).map((c) => c.width ?? DEFAULT_TRACK);
  return ['minmax(0, 1fr)', ...cols, 'auto'].join(' ');
}

/**
 * The host of a column list: it carries the one declared track set (as a variable every row
 * inherits, which is why the columns align without `subgrid` and without a track per row), the
 * head line, and the size container the columns collapse against - the LIST's own width, so a list
 * inside a narrow tile collapses even though the surface is wide.
 *
 * The head line is `aria-hidden`, as `ContextGroups`'s is: a reader hears a column's name from the
 * `sr-only` label the cell itself carries, so the heads are not read again as a row of their own.
 */
export function RowList({ columns, nameHead, label, pager, children }: {
  columns: readonly RowColumn[];
  /** The name column's head; with it (or any column head) the list draws a head line. */
  nameHead?: ReactNode;
  label?: string;
  pager?: ReactNode;
  children: ReactNode;
}) {
  const style = useMemo(() => ({
    '--row-tracks': tracks(columns, false),
    '--row-tracks-narrow': tracks(columns, true),
  }) as CSSProperties, [columns]);
  const heads = nameHead != null || columns.some((c) => c.head != null);
  return (
    <RowColumnsContext.Provider value={columns}>
      <div className="k-rowcols" style={style}>
        {heads && (
          <div className="k-rowhead typo-label k-regular k-quiet" aria-hidden="true">
            <span>{nameHead}</span>
            {columns.map((c, i) => (
              <span key={i} className={cx(c.align === 'end' && 'k-rowhead__end')} data-collapse={c.collapse || undefined}>{c.head}</span>
            ))}
            <span />
          </div>
        )}
        <div className="k-rows k-rows--cols">{children}</div>
        {pager && <nav className="k-pager" aria-label={label}>{pager}</nav>}
      </div>
    </RowColumnsContext.Provider>
  );
}

/** A row's cells, in the columns the list declared; a cell ellipsizes and never wraps the row taller. */
export function RowCells({ cells }: { cells: readonly ReactNode[] }) {
  const columns = useRowColumns();
  // No declared set, no cells: a cell with no track of its own would fall into the trail's `auto`
  // column and break the row. The LIST owns the shape, so a row without one keeps the two-cell form.
  if (!columns) return null;
  return (
    <>
      {cells.map((cell, i) => {
        const col = columns?.[i];
        return (
          <div
            key={i}
            className={cx('k-row__cell', col?.align === 'end' && 'k-row__cell--end')}
            data-collapse={col?.collapse || undefined}
          >
            {typeof col?.head === 'string' && <span className="sr-only">{`${col.head}: `}</span>}
            {cell}
          </div>
        );
      })}
    </>
  );
}
