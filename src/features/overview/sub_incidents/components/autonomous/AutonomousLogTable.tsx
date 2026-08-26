// Prototype variant A — "Autonomous log: compact table"
//
// One row per incident the system handled itself, as a plain dense table:
// severity, what it was, where it came from, whose agent, when it was resumed.
// Sortable columns, paginated, no grouping. Optimised for "show me everything
// that happened while I wasn't looking" in as few pixels as possible.
//
// Prototype-local copy (COPY) — extracted to i18n at consolidation.

import { useMemo, useState } from 'react';
import { ShieldCheck, ArrowUpRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import {
  severityBadgeClass, sourceTableIcon, sourceTableLabel,
} from '../../libs/incidentTaxonomy';
import { LedgerPager } from '../ledger/LedgerPager';
import { PAGE_SIZES, type PageSize } from '../../libs/useIncidentLedger';

const GRID = 'minmax(96px, 0.6fr) minmax(220px, 2.2fr) minmax(120px, 1fr) minmax(110px, 1fr) 120px 40px';

const COPY = {
  severity: 'Severity',
  incident: 'Incident',
  source: 'Source',
  agent: 'Agent',
  handled: 'Resumed',
  open: 'Open incident',
};

export interface AutonomousLogProps {
  incidents: AuditIncident[];
  loading: boolean;
  onOpenIncident: (incident: AuditIncident) => void;
}

export function AutonomousLogTable({ incidents, loading, onOpenIncident }: AutonomousLogProps) {
  const { t } = useTranslation();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(PAGE_SIZES[0]);

  // Newest resumption first — this is a log, so recency is the only order that
  // needs to be the default.
  const sorted = useMemo(
    () => [...incidents].sort((a, b) =>
      Date.parse(b.continuedAt ?? b.createdAt) - Date.parse(a.continuedAt ?? a.createdAt)),
    [incidents],
  );
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const start = safeIndex * pageSize;
  const page = sorted.slice(start, start + pageSize);
  const enter = useRevealTracker(`${safeIndex}|${pageSize}`);

  if (loading && incidents.length === 0) {
    return <ListSkeleton calm rows={6} rowHeight={40} />;
  }

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
      <div className="flex items-center gap-2 border-b border-primary/10 px-4 py-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
        <h3 className="typo-heading text-foreground">{t.overview.incidents.noc_handled_title}</h3>
        <AthenaComposedBadge variant="handled" label={t.overview.incidents.noc_handled_by} />
      </div>

      <div
        className="sticky top-0 z-10 grid items-center gap-2 border-b border-primary/10 bg-background/95 px-4 py-1.5"
        style={{ gridTemplateColumns: GRID }}
        role="row"
      >
        {[COPY.severity, COPY.incident, COPY.source, COPY.agent, COPY.handled, ''].map((label, i) => (
          <span
            key={label || `col-${i}`}
            className={`typo-caption font-mono uppercase tracking-widest text-foreground ${i === 4 ? 'text-right' : ''}`}
          >
            {label}
          </span>
        ))}
      </div>

      <div>
        {page.map((inc, index) => {
          const SourceIcon = sourceTableIcon(inc.sourceTable);
          return (
            <RevealItem
              key={inc.id}
              revealId={inc.id}
              order={index}
              hasEntered={enter.hasEntered}
              markEntered={enter.markEntered}
            >
              <button
                type="button"
                onClick={() => onOpenIncident(inc)}
                style={{ gridTemplateColumns: GRID }}
                className={`grid w-full items-center gap-2 border-b border-b-primary/[0.06] px-4 py-1.5 text-left transition-colors hover:bg-secondary/25 focus-ring ${
                  index % 2 === 1 ? 'bg-primary/[0.02]' : ''
                }`}
              >
                <span className={`inline-flex w-fit items-center rounded-card border px-1.5 py-0.5 typo-caption font-mono uppercase tracking-wider ${severityBadgeClass(inc.severity)}`}>
                  {tokenLabel(t, 'severity', inc.severity)}
                </span>
                <span className="truncate typo-body text-foreground">{inc.title}</span>
                <span className="flex min-w-0 items-center gap-1.5 typo-caption font-mono text-foreground">
                  <SourceIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{sourceTableLabel(t, inc.sourceTable)}</span>
                </span>
                <span className="truncate typo-caption font-mono text-foreground">{inc.personaName ?? '—'}</span>
                <span className="text-right typo-caption font-mono text-foreground">
                  {inc.continuedAt ? <RelativeTime timestamp={inc.continuedAt} /> : '—'}
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 justify-self-end text-foreground" aria-label={COPY.open} />
              </button>
            </RevealItem>
          );
        })}
      </div>

      <LedgerPager
        dense
        pageIndex={safeIndex}
        pageCount={pageCount}
        pageSize={pageSize}
        rangeStart={sorted.length === 0 ? 0 : start + 1}
        rangeEnd={Math.min(start + pageSize, sorted.length)}
        total={sorted.length}
        onPageChange={setPageIndex}
        onPageSizeChange={(size) => { setPageSize(size); setPageIndex(0); }}
      />
    </div>
  );
}
