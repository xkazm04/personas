// Pagination footer for the incidents ledger and the autonomous log.

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { PAGE_SIZES, type PageSize } from '../../libs/useIncidentLedger';

interface Props {
  pageIndex: number;
  pageCount: number;
  pageSize: PageSize;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  onPageChange: (index: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  /** Tighter padding for the dense ledger; roomier for the audit trail. */
  dense?: boolean;
}

export function LedgerPager({
  pageIndex, pageCount, pageSize, rangeStart, rangeEnd, total,
  onPageChange, onPageSizeChange, dense = false,
}: Props) {
  const { t, tx } = useTranslation();
  const l = t.overview.incidents.ledger;
  const atFirst = pageIndex <= 0;
  const atLast = pageIndex >= pageCount - 1;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 bg-secondary/10 ${
        dense ? 'px-3 py-1.5' : 'px-4 py-2.5'
      }`}
    >
      <span className="typo-caption text-foreground tabular-nums">
        {tx(l.showing_range, { start: rangeStart, end: rangeEnd, total })}
      </span>

      <div className="flex items-center gap-3">
        {/* ThemedSelect, not a native select element — native options render
            OS-styled. `hideSearch` because three fixed sizes need no
            type-ahead. */}
        <label className="flex items-center gap-1.5 typo-caption text-foreground">
          <ThemedSelect
            filterable
            hideSearch
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v) as PageSize)}
            options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
            wrapperClassName="w-16"
            aria-label={l.per_page}
          />
          {l.per_page}
        </label>

        <div className="flex items-center gap-0.5">
          <PagerButton label={l.first_page} disabled={atFirst} onClick={() => onPageChange(0)}>
            <ChevronsLeft className="h-3.5 w-3.5" />
          </PagerButton>
          <PagerButton label={l.prev_page} disabled={atFirst} onClick={() => onPageChange(pageIndex - 1)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </PagerButton>
          <span className="px-2 typo-caption text-foreground tabular-nums">
            {tx(l.page_indicator, { page: pageIndex + 1, pages: pageCount })}
          </span>
          <PagerButton label={l.next_page} disabled={atLast} onClick={() => onPageChange(pageIndex + 1)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </PagerButton>
          <PagerButton label={l.last_page} disabled={atLast} onClick={() => onPageChange(pageCount - 1)}>
            <ChevronsRight className="h-3.5 w-3.5" />
          </PagerButton>
        </div>
      </div>
    </div>
  );
}

/** Shared Button owns the disabled treatment — no hand-rolled `disabled:` classes. */
function PagerButton({
  label, disabled, onClick, children,
}: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  );
}
