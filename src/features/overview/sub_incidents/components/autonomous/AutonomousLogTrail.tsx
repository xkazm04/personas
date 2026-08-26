// Prototype variant B — "Autonomous log: audit trail"
//
// Same flat, paginated ledger, but shaped to answer "what did the system do on
// my behalf, and can I trust it?" A summary strip states the volume, the most
// recent resumption and the sources involved; each entry is a two-row record
// matching the inbox variants — title on line 1, provenance metadata on line 2
// (source, agent, when it fired, when it was resumed, how long it sat).
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
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import { severityBadgeClass, sourceTableIcon, sourceTableLabel } from '../../libs/incidentTaxonomy';
import { LedgerPager } from '../ledger/LedgerPager';
import { PAGE_SIZES, type PageSize } from '../../libs/useIncidentLedger';
import type { AutonomousLogProps } from './AutonomousLogTable';

const GRID = 'minmax(96px, 0.6fr) minmax(140px, 1fr) minmax(120px, 1fr) minmax(110px, 0.9fr) minmax(110px, 0.9fr) 40px';

const COPY = {
  severity: 'Severity',
  source: 'Source',
  agent: 'Agent',
  raised: 'Raised',
  resumed: 'Resumed',
  handledTotal: 'handled without you',
  lastAt: 'most recent',
  sources: 'sources',
  open: 'Open incident',
};

/** Milliseconds between an incident being raised and the system resuming it. */
function latencyLabel(inc: AuditIncident): string | null {
  if (!inc.continuedAt) return null;
  const ms = Date.parse(inc.continuedAt) - Date.parse(inc.createdAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

export function AutonomousLogTrail({ incidents, loading, onOpenIncident }: AutonomousLogProps) {
  const { t } = useTranslation();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<PageSize>(PAGE_SIZES[0]);

  const sorted = useMemo(
    () => [...incidents].sort((a, b) =>
      Date.parse(b.continuedAt ?? b.createdAt) - Date.parse(a.continuedAt ?? a.createdAt)),
    [incidents],
  );
  const distinctSources = useMemo(
    () => new Set(incidents.map((i) => i.sourceTable)).size,
    [incidents],
  );
  const mostRecent = sorted[0]?.continuedAt ?? null;

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const start = safeIndex * pageSize;
  const page = sorted.slice(start, start + pageSize);
  const enter = useRevealTracker(`${safeIndex}|${pageSize}`);

  if (loading && incidents.length === 0) {
    return <ListSkeleton calm rows={6} rowHeight={56} />;
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
      {/* Summary strip — the trail states its own scale before its rows. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-primary/10 bg-status-success/[0.04] px-4 py-2.5">
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
          <h3 className="typo-heading text-foreground">{t.overview.incidents.noc_handled_title}</h3>
        </span>
        <AthenaComposedBadge variant="handled" label={t.overview.incidents.noc_handled_by} />
        <span className="typo-caption text-foreground">
          <Numeric value={incidents.length} className="typo-body text-foreground tabular-nums" /> {COPY.handledTotal}
        </span>
        {mostRecent && (
          <span className="typo-caption text-foreground">
            {COPY.lastAt} <RelativeTime timestamp={mostRecent} className="typo-caption text-foreground" />
          </span>
        )}
        <span className="typo-caption text-foreground">
          <Numeric value={distinctSources} className="typo-caption text-foreground tabular-nums" /> {COPY.sources}
        </span>
      </div>

      <div
        className="sticky top-0 z-10 grid items-center gap-3 border-b border-primary/10 bg-background/95 px-4 py-1.5 pl-7"
        style={{ gridTemplateColumns: GRID }}
        role="row"
      >
        {[COPY.severity, COPY.source, COPY.agent, COPY.raised, COPY.resumed, ''].map((label, i) => (
          <span key={label || `col-${i}`} className="typo-caption uppercase tracking-wider font-semibold text-foreground">
            {label}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 px-3 py-2">
        {page.map((inc, index) => {
          const SourceIcon = sourceTableIcon(inc.sourceTable);
          const latency = latencyLabel(inc);
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
                className="relative w-full overflow-hidden rounded-card border border-primary/10 bg-secondary/20 text-left transition-colors hover:border-primary/25 hover:bg-secondary/35 focus-ring"
              >
                <span className="absolute inset-y-0 left-0 w-[3px] bg-status-success/70" aria-hidden="true" />
                <div className="flex items-center justify-between gap-3 pl-4 pr-3 pt-2.5">
                  <span className="typo-body font-medium text-foreground">{inc.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {latency && (
                      <span className="rounded-card border border-status-success/25 bg-status-success/10 px-1.5 py-0.5 typo-caption text-status-success tabular-nums">
                        {latency}
                      </span>
                    )}
                    <ArrowUpRight className="h-3.5 w-3.5 text-foreground" aria-label={COPY.open} />
                  </span>
                </div>
                <div
                  className="grid items-center gap-3 pl-4 pr-3 pb-2.5 pt-1.5"
                  style={{ gridTemplateColumns: GRID }}
                >
                  <span className={`inline-flex w-fit items-center rounded-card border px-1.5 py-0.5 typo-caption ${severityBadgeClass(inc.severity)}`}>
                    {tokenLabel(t, 'severity', inc.severity)}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 typo-caption text-foreground">
                    <SourceIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{sourceTableLabel(t, inc.sourceTable)}</span>
                  </span>
                  <span className="truncate typo-caption text-foreground">{inc.personaName ?? '—'}</span>
                  <RelativeTime timestamp={inc.createdAt} className="typo-caption text-foreground" />
                  <span className="typo-caption text-foreground">
                    {inc.continuedAt ? <RelativeTime timestamp={inc.continuedAt} /> : '—'}
                  </span>
                  <span />
                </div>
              </button>
            </RevealItem>
          );
        })}
      </div>

      <LedgerPager
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
