// Shared scaffolding for the autonomous-log variants: one sort (newest
// resumption first), one paging model, the same loading/empty treatment.
// Each variant supplies only its row renderer, so the three directions differ
// in typography and symbol strategy — never in behaviour.

import { useMemo, useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
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
  incidents, loading, header, rowHeight, dense, rowsClassName, renderRow,
}: Pick<AutonomousLogProps, 'incidents' | 'loading'> & {
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
  if (incidents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <ShieldCheck className="h-6 w-6 text-status-success" aria-hidden="true" />
        <p className="typo-body text-foreground">{t.overview.incidents.noc_handled_empty}</p>
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
