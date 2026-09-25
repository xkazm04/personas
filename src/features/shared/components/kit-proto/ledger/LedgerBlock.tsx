/**
 * Ledger block + list row (Ledger kit): column heads, rows and ghost rows on the
 * shared grid (`grid.ts`). A row owns its height (44 / 56), the 3px leading status
 * mark in `tone` (primary glows, `hollow` is an outline), ONE emphasised name, a
 * caption sub line, the hairline under it, hover wash, selected wash + inset + glow.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ledgerColsStyle, type LedgerSpec, type LedgerTone } from './grid';

export function LedgerBlock({ spec, label, role = 'table', head, children, 'data-testid': testId }: {
  spec: LedgerSpec;
  label?: string;
  role?: 'table' | 'list';
  head?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div className="lg-wrap">
      <div className="lg" role={role} aria-label={label} style={ledgerColsStyle(spec)} data-testid={testId}>
        {head}
        <div className="lg-body">{children}</div>
      </div>
    </div>
  );
}

export interface ColumnHead {
  label: ReactNode;
  /** Sort key; omitted = a plain label. */
  sort?: string;
}

/** Column heads: `typo-label`, figures right-aligned, sortable heads carry an arrow + aria-sort. */
export function ColHead({ spec, primary, meta, figs = [], time, sortKey, sortDir, onSort }: {
  spec: LedgerSpec;
  primary: ReactNode;
  meta?: ReactNode;
  figs?: ColumnHead[];
  time?: ColumnHead;
  sortKey?: string;
  sortDir?: 1 | -1;
  onSort?: (key: string) => void;
}) {
  const cell = (c: ColumnHead, i: number) => {
    if (!c.sort || !onSort) return <span key={i} className="typo-label is-num">{c.label}</span>;
    const on = sortKey === c.sort;
    return (
      <span key={i} className="is-num">
        <button
          type="button"
          className="sort typo-label"
          aria-sort={on ? (sortDir === 1 ? 'ascending' : 'descending') : undefined}
          onClick={() => onSort(c.sort!)}
        >
          {c.label}<span className="sort-arrow" />
        </button>
      </span>
    );
  };
  return (
    <div className="lg-row lg-colhead" data-h="1" role="row" data-role="lg-colhead">
      <span />
      <span className="typo-label" data-role="lg-colhead-label">{primary}</span>
      {spec.meta && <span className="typo-label">{meta}</span>}
      {figs.map(cell)}
      {spec.time && cell(time ?? { label: '' }, figs.length)}
      {spec.act && <span />}
    </div>
  );
}

/** Name + sub line for the primary cell. `nameClass` defaults to the row's one emphasis, `typo-title`. */
export function RowPrimary({ name, sub, nameClass = 'typo-title' }: { name: ReactNode; sub?: ReactNode; nameClass?: string }) {
  return (
    <>
      <span className={`lg-name ${nameClass}`} data-role="lg-name">{name}</span>
      {sub != null && <span className="lg-sub typo-caption" data-role="lg-sub">{sub}</span>}
    </>
  );
}

export function LedgerRow({ spec, rowKey, tone, hollow, primary, meta, figures = [], time, height = 2, selected, muted, wrapSelectedName, onSelect, 'data-testid': testId }: {
  spec: LedgerSpec;
  rowKey?: string;
  tone?: LedgerTone | null;
  hollow?: boolean;
  primary: ReactNode;
  meta?: ReactNode;
  figures?: ReactNode[];
  time?: ReactNode;
  height?: 1 | 2;
  selected?: boolean;
  muted?: boolean;
  /** A selected name that overflows its track takes the sub line's place (the folio repeats the sub). */
  wrapSelectedName?: boolean;
  onSelect?: () => void;
  'data-testid'?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [nameWrap, setNameWrap] = useState(false);
  useLayoutEffect(() => {
    const n = ref.current?.querySelector<HTMLElement>('.lg-name');
    setNameWrap(!!(selected && wrapSelectedName && n && n.scrollWidth > n.clientWidth + 1));
  }, [selected, wrapSelectedName, primary]);
  const link = !!onSelect;
  const cls = ['lg-row', link && 'is-link', selected && 'is-selected', muted && 'is-muted', nameWrap && 'is-name-wrap']
    .filter(Boolean).join(' ');
  return (
    <div
      ref={ref}
      className={cls}
      role="row"
      data-h={height}
      data-key={rowKey}
      data-tone={tone ?? undefined}
      data-hollow={hollow ? '' : undefined}
      data-role={selected ? 'lg-row-selected' : 'lg-row'}
      data-testid={testId}
      aria-selected={link ? !!selected : undefined}
      tabIndex={link ? (selected ? 0 : -1) : undefined}
      onClick={onSelect}
    >
      <span className="c-mark" aria-hidden="true" />
      <span className="c-pri" role="cell">{primary}</span>
      {spec.meta && <span className="c-meta" role="cell">{meta}</span>}
      {figures.map((f, i) => <span key={i} className="c-fig" role="cell">{f}</span>)}
      {spec.time && <span className="c-time typo-caption" role="cell" data-role="lg-time">{time}</span>}
    </div>
  );
}
