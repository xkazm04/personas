// Shared pagination footer for the incident ledger variants.
// Prototype-local copy (COPY) per the /prototype convention — extracted to
// i18n at consolidation.

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { PAGE_SIZES, type PageSize } from '../../libs/useIncidentLedger';

const COPY = {
  showing: 'Showing',
  of: 'of',
  perPage: 'per page',
  first: 'First page',
  prev: 'Previous page',
  next: 'Next page',
  last: 'Last page',
  page: 'Page',
};

interface Props {
  pageIndex: number;
  pageCount: number;
  pageSize: PageSize;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  onPageChange: (index: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  /** Tighter padding + mono numerals for the dense ledger variant. */
  dense?: boolean;
}

export function LedgerPager({
  pageIndex, pageCount, pageSize, rangeStart, rangeEnd, total,
  onPageChange, onPageSizeChange, dense = false,
}: Props) {
  const atFirst = pageIndex <= 0;
  const atLast = pageIndex >= pageCount - 1;
  const numeric = dense ? 'font-mono tabular-nums' : 'tabular-nums';

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 bg-secondary/10 ${
        dense ? 'px-3 py-1.5' : 'px-4 py-2.5'
      }`}
    >
      <span className="typo-caption text-foreground">
        {COPY.showing} <span className={numeric}>{rangeStart}–{rangeEnd}</span> {COPY.of}{' '}
        <span className={numeric}>{total}</span>
      </span>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 typo-caption text-foreground">
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
            className="rounded-input border border-primary/15 bg-secondary/40 px-1.5 py-0.5 typo-caption text-foreground focus-ring"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          {COPY.perPage}
        </label>

        <div className="flex items-center gap-0.5">
          <PagerButton label={COPY.first} disabled={atFirst} onClick={() => onPageChange(0)}>
            <ChevronsLeft className="h-3.5 w-3.5" />
          </PagerButton>
          <PagerButton label={COPY.prev} disabled={atFirst} onClick={() => onPageChange(pageIndex - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </PagerButton>
          <span className={`px-2 typo-caption text-foreground ${numeric}`}>
            {COPY.page} {pageIndex + 1}/{pageCount}
          </span>
          <PagerButton label={COPY.next} disabled={atLast} onClick={() => onPageChange(pageIndex + 1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </PagerButton>
          <PagerButton label={COPY.last} disabled={atLast} onClick={() => onPageChange(pageCount - 1)}>
            <ChevronsRight className="h-3.5 w-3.5" />
          </PagerButton>
        </div>
      </div>
    </div>
  );
}

function PagerButton({
  label, disabled, onClick, children,
}: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-card border border-primary/15 p-1 text-foreground transition-colors hover:bg-secondary/50 disabled:opacity-35 disabled:hover:bg-transparent focus-ring"
    >
      {children}
    </button>
  );
}
