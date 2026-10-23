// Shared scaffolding for the autonomous-log variants: one sort (newest
// resumption first), one paging model, the same loading/empty treatment.
// Each variant supplies only its row renderer, so the three directions differ
// in typography and symbol strategy — never in behaviour.

import { useMemo, useState, type ReactNode } from 'react';
import { InboxZero } from '@/features/shared/components/feedback/ScenarioEmptyState';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import { LedgerPager } from '../ledger/LedgerPager';
import { PAGE_SIZES, type PageSize } from '../../libs/useIncidentLedger';
import type { AutonomousLogProps } from './autonomousLogTypes';

export function resumedAt(inc: AuditIncident): string {
  return inc.continuedAt ?? inc.createdAt;
}

export function useAutonomousPage(incidents: AuditIncident[]) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(PAGE_SIZES[0]);
  const sorted = useMemo(
    () => [...incidents].sort((a, b) => Date.parse(resumedAt(b)) - Date.parse(resumedAt(a))),
    [incidents],
  );
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const start = safeIndex * pageSize;
  return {
    sorted,
    page: sorted.slice(start, start + pageSize),
    pager: {
      pageIndex: safeIndex,
      pageCount,
      pageSize,
      rangeStart: sorted.length === 0 ? 0 : start + 1,
      rangeEnd: Math.min(start + pageSize, sorted.length),
      total: sorted.length,
      onPageChange: setPageIndex,
      onPageSizeChange: (size: PageSize) => { setPageSize(size); setPageIndex(0); },
    },
    revealKey: `${safeIndex}|${pageSize}`,
  };
}

/** Loading + empty states, then the variant's rows, then the pager. */
export function AutonomousLogFrame({
  incidents, loading, failed, onRetry, header, rowHeight, dense, rowsClassName, renderRow,
}: Pick<AutonomousLogProps, 'incidents' | 'loading' | 'failed' | 'onRetry'> & {
  header: ReactNode;
  rowHeight: number;
  dense?: boolean;
  rowsClassName?: string;
  renderRow: (inc: AuditIncident, index: number) => ReactNode;
}) {
  const { t } = useTranslation();
  const { page, pager, revealKey } = useAutonomousPage(incidents);
  const enter = useRevealTracker(revealKey);

  if (loading && incidents.length === 0) return <ListSkeleton calm rows={6} rowHeight={rowHeight} />;
  // A failed read with nothing to show is unknown, not an inbox-zero: the
  // celebration would certify that the system handled nothing.
  if (failed && incidents.length === 0) {
    return (
      <div className="px-4 py-3">
        <InlineErrorBanner message={t.overview.incidents.load_failed} onRetry={onRetry} />
      </div>
    );
  }
  if (incidents.length === 0) {
    return (
      <div className="flex justify-center px-4 py-8">
        <InboxZero title={t.overview.incidents.noc_handled_empty} />
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {header}
      <div className={rowsClassName}>
        {page.map((inc, index) => (
          <RevealItem key={inc.id} revealId={inc.id} order={index} hasEntered={enter.hasEntered} markEntered={enter.markEntered}>
            {renderRow(inc, index)}
          </RevealItem>
        ))}
      </div>
      <LedgerPager dense={dense} {...pager} />
    </div>
  );
}
