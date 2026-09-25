import type { ReactNode } from 'react';
import { Mark } from './Mark';
import { emptyBand, Ghost, type EmptySpec } from './states';
import { cx, kitAttrs, stateClass, type Glyph, type KitStates, type Tone } from './types';

export interface TableCol<K extends string> {
  key: K;
  label: ReactNode;
  /** Numeric/time column: right-aligned, nowrap. */
  num?: boolean;
}

export interface TableRow<K extends string> {
  id: string;
  cells: Partial<Record<K, ReactNode>>;
  mark?: { tone: Tone; glyph?: Glyph; label: string };
  state?: KitStates;
}

/**
 * DataTable: a DataTable row IS a ListRow under column heads (same band, mark, selection), which
 * is why a table and a list read as one family. The table is as tall as its rows and the pager
 * sits directly under the last one.
 * @catalog DataTable - column heads over ListRow-family rows (band, mark, selection), pager under the last row. Kit.
 */
export function DataTable<K extends string>({ cols, rows, label, loading, empty, pager, onRowClick, rowTestId }: {
  cols: ReadonlyArray<TableCol<K>>;
  rows: ReadonlyArray<TableRow<K>>;
  label: string;
  loading?: boolean;
  empty: EmptySpec;
  pager?: ReactNode;
  onRowClick?: (id: string) => void;
  rowTestId?: string;
}) {
  const st = loading ? 'loading' : rows.length === 0 ? 'empty' : 'default';
  return (
    <div className={cx('k-tablewrap', stateClass(st))} {...kitAttrs('DataTable', st)}>
      <table className="k-table" aria-label={label} aria-busy={loading || undefined}>
        <thead>
          <tr>
            {cols.map((c) => <th key={c.key} scope="col" className={cx('typo-label k-regular', c.num && 'k-num')}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {st === 'loading' && [0, 1, 2].map((i) => (
            <tr key={i} className="is-loading" aria-hidden="true">
              {cols.map((c, ci) => (
                <td key={c.key} className={c.num ? 'k-num' : undefined}>
                  {ci === 0 ? (
                    <>
                      <span className="k-mark" />
                      <span className="k-cell2" style={{ gap: 8 }}><Ghost width="55%" /><Ghost width="32%" height="8px" /></span>
                    </>
                  ) : <Ghost width="48px" inline />}
                </td>
              ))}
            </tr>
          ))}
          {st === 'empty' && (
            <tr><td colSpan={cols.length} style={{ height: 'auto', padding: 0 }}>{emptyBand(empty)}</td></tr>
          )}
          {st === 'default' && rows.map((r) => (
            <tr
              key={r.id}
              className={stateClass(r.state)}
              {...kitAttrs('ListRow', r.state)}
              data-kit-variant="table"
              data-id={r.id}
              data-testid={rowTestId}
              data-nav={onRowClick ? 'row' : undefined}
              tabIndex={onRowClick ? -1 : undefined}
              aria-selected={onRowClick ? (typeof r.state === 'string' ? r.state === 'selected' : !!r.state?.includes('selected')) : undefined}
              onClick={onRowClick ? () => onRowClick(r.id) : undefined}
            >
              {cols.map((c, ci) => (
                <td key={c.key} className={c.num ? 'k-num' : undefined}>
                  {ci === 0 && r.mark && <Mark tone={r.mark.tone} glyph={r.mark.glyph} label={r.mark.label} />}
                  {r.cells[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {st !== 'loading' && pager && <nav className="k-pager" aria-label={label}>{pager}</nav>}
    </div>
  );
}
