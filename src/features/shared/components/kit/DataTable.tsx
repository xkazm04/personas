import { useState, type ReactNode } from 'react';
import { SortableHeader } from '@/features/shared/components/display/SortableHeader';
import { useTranslation } from '@/i18n/useTranslation';
import { Mark } from './Mark';
import { nextSort, sortRows, type SortDir, type SortValue, type TableSort } from './sortRows';
import { emptyBand, Ghost, type EmptySpec } from './states';
import { cx, kitAttrs, stateClass, type Glyph, type KitStates, type Tone } from './types';

export interface TableCol<K extends string> {
  key: K;
  label: ReactNode;
  /** Numeric/time column: right-aligned, nowrap. */
  num?: boolean;
  /** Opt in to sorting: the direction a first press opens in ('desc' for magnitudes and times, 'asc' for names). */
  sortable?: SortDir;
  /** Accessible column name for the sort button when `label` is not a string. */
  sortLabel?: string;
}

export interface TableRow<K extends string> {
  id: string;
  cells: Partial<Record<K, ReactNode>>;
  mark?: { tone: Tone; glyph?: Glyph; label: string };
  state?: KitStates;
  /** The value each sortable column orders by (cells are nodes, so they cannot be compared). */
  sort?: Partial<Record<K, SortValue>>;
}

/**
 * DataTable: a DataTable row IS a ListRow under column heads (same band, mark, selection), which
 * is why a table and a list read as one family. The table is as tall as its rows and the pager
 * sits directly under the last one. A column with `sortable` gets a sort button head (aria-sort,
 * one caret, the change announced politely); rows then carry `sort` values (sortRows.ts).
 * @catalog DataTable - column heads over ListRow-family rows (band, mark, selection), pager under the last row, opt-in sortable heads. Kit.
 */
export function DataTable<K extends string>({ cols, rows: given, label, loading, empty, pager, onRowClick, rowTestId, testId, sort, defaultSort, onSortChange, locale }: {
  cols: ReadonlyArray<TableCol<K>>;
  rows: ReadonlyArray<TableRow<K>>;
  label: string;
  loading?: boolean;
  empty: EmptySpec;
  pager?: ReactNode;
  onRowClick?: (id: string) => void;
  rowTestId?: string;
  testId?: string;
  /** Controlled sort (with onSortChange). */
  sort?: TableSort<K> | null;
  /** Uncontrolled: the sort the table opens with. */
  defaultSort?: TableSort<K>;
  onSortChange?: (sort: TableSort<K>) => void;
  /** The reader's locale for text collation. */
  locale?: string;
}) {
  const { t, tx } = useTranslation();
  const [own, setOwn] = useState<TableSort<K> | null>(defaultSort ?? null);
  const [announce, setAnnounce] = useState('');
  const sortable = cols.some((c) => c.sortable);
  const active = sort !== undefined ? sort : own;
  const rows = sortable ? sortRows(given, active, locale) : given;
  const press = (c: TableCol<K>) => {
    const next = nextSort(active, c.key, c.sortable!);
    if (sort === undefined) setOwn(next);
    onSortChange?.(next);
    const name = c.sortLabel ?? (typeof c.label === 'string' ? c.label : c.key);
    setAnnounce(tx(next.dir === 'asc' ? t.shared.sort_active_asc : t.shared.sort_active_desc, { label: name }));
  };
  const st = loading ? 'loading' : rows.length === 0 ? 'empty' : 'default';
  return (
    <div className={cx('k-tablewrap', stateClass(st))} {...kitAttrs('DataTable', st)} data-testid={testId}>
      <table className="k-table" aria-label={label} aria-busy={loading || undefined}>
        <thead>
          <tr>
            {cols.map((c) => c.sortable ? (
              <SortableHeader
                key={c.key}
                label={c.sortLabel ?? (typeof c.label === 'string' ? c.label : c.key)}
                active={active?.key === c.key}
                dir={active?.key === c.key ? active.dir : c.sortable}
                onSort={() => press(c)}
                align={c.num ? 'right' : 'left'}
                padding=""
                className={cx('k-th-sort', c.num && 'k-num')}
                buttonClassName="k-th-sort__btn typo-label k-regular"
              />
            ) : <th key={c.key} scope="col" className={cx('typo-label k-regular', c.num && 'k-num')}>{c.label}</th>)}
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
          {st === 'default' && rows.map((r) => {
            const selected = typeof r.state === 'string' ? r.state === 'selected' : !!r.state?.includes('selected');
            return (
            <tr
              key={r.id}
              className={stateClass(r.state)}
              {...kitAttrs('ListRow', r.state)}
              data-kit-variant="table"
              data-id={r.id}
              data-testid={rowTestId}
              data-nav={onRowClick ? 'row' : undefined}
              // Roving tabindex: the selected row is the table's one tab stop; j/k move it.
              tabIndex={onRowClick ? (selected ? 0 : -1) : undefined}
              aria-selected={onRowClick ? selected : undefined}
              onClick={onRowClick ? () => onRowClick(r.id) : undefined}
            >
              {cols.map((c, ci) => (
                <td key={c.key} className={c.num ? 'k-num' : undefined}>
                  {ci === 0 && r.mark && <Mark tone={r.mark.tone} glyph={r.mark.glyph} label={r.mark.label} />}
                  {r.cells[c.key]}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
      {st !== 'loading' && pager && <nav className="k-pager" aria-label={label}>{pager}</nav>}
      {sortable && <span className="sr-only" role="status" aria-live="polite">{announce}</span>}
    </div>
  );
}
