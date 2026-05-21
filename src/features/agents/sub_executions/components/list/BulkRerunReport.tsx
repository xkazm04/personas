import { Layers, X, TrendingDown, TrendingUp, ChevronRight } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { fmtCost } from '../../libs/comparisonHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import type { BulkRunItem, BulkRunCohort } from '../../libs/useBulkRerun';

interface BulkRerunReportProps {
  cohort: BulkRunCohort;
  items: BulkRunItem[];
  onClose: () => void;
  onCompareItem: (originalId: string, newExecutionId: string) => void;
}

function deltaTone(delta: number, lowerIsBetter = true): string {
  if (Math.abs(delta) < 1e-6) return 'text-foreground';
  const good = lowerIsBetter ? delta < 0 : delta > 0;
  return good ? 'text-emerald-400' : 'text-amber-400';
}

export function BulkRerunReport({ cohort, items, onClose, onCompareItem }: BulkRerunReportProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;

  const successRate = cohort.total === 0
    ? 0
    : Math.round((cohort.successCount / cohort.total) * 100);
  const costDeltaTone = deltaTone(cohort.meanCostDelta, true);
  const durDeltaTone = deltaTone(cohort.meanDurationDeltaMs, true);

  const regressions = items.filter(
    (it) =>
      it.newStatus &&
      it.origStatus === 'completed' &&
      (it.newStatus === 'failed' || it.newStatus === 'cancelled' || it.newStatus === 'timeout'),
  );
  const recoveries = items.filter(
    (it) =>
      it.newStatus &&
      (it.origStatus === 'failed' || it.origStatus === 'cancelled' || it.origStatus === 'timeout') &&
      it.newStatus === 'completed',
  );

  return (
    <div className="space-y-4" data-testid="bulk-rerun-report">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary/70" />
          <h3 className="typo-heading text-foreground">{e.bulk_rerun_report_title}</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-foreground hover:text-muted-foreground/80 transition-colors"
          aria-label={e.bulk_rerun_close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label={e.bulk_rerun_success_rate}
          value={`${successRate}%`}
          sub={tx(e.bulk_rerun_count_of_total, { n: cohort.successCount, total: cohort.total })}
          tone={successRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}
        />
        <SummaryCard
          label={e.bulk_rerun_recovered}
          value={String(cohort.recoveredCount)}
          sub={e.bulk_rerun_recovered_sub}
          tone="text-emerald-400"
        />
        <SummaryCard
          label={e.bulk_rerun_regressions}
          value={String(cohort.regressionCount)}
          sub={e.bulk_rerun_regressions_sub}
          tone={cohort.regressionCount > 0 ? 'text-amber-400' : 'text-foreground'}
        />
        <SummaryCard
          label={e.bulk_rerun_mean_cost_delta}
          value={fmtCost(Math.abs(cohort.meanCostDelta))}
          sub={cohort.meanCostDelta < 0 ? e.bulk_rerun_cheaper : cohort.meanCostDelta > 0 ? e.bulk_rerun_pricier : e.bulk_rerun_no_change}
          tone={costDeltaTone}
          icon={cohort.meanCostDelta < 0 ? <TrendingDown className="w-3 h-3" /> : cohort.meanCostDelta > 0 ? <TrendingUp className="w-3 h-3" /> : null}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 typo-body">
        <KvCell label={e.bulk_rerun_total_cost_original} value={fmtCost(cohort.totalCostOriginal)} />
        <KvCell label={e.bulk_rerun_total_cost_new} value={fmtCost(cohort.totalCostNew)} />
        <KvCell
          label={e.bulk_rerun_mean_duration_delta}
          value={formatDuration(Math.abs(cohort.meanDurationDeltaMs))}
          tone={durDeltaTone}
        />
        <KvCell
          label={e.bulk_rerun_failed_count}
          value={String(cohort.failedCount)}
          tone={cohort.failedCount > 0 ? 'text-red-400' : 'text-foreground'}
        />
      </div>

      {regressions.length > 0 && (
        <Section title={e.bulk_rerun_regressions_section} tone="amber">
          <CohortRowList rows={regressions} onCompareItem={onCompareItem} />
        </Section>
      )}

      {recoveries.length > 0 && (
        <Section title={e.bulk_rerun_recoveries_section} tone="emerald">
          <CohortRowList rows={recoveries} onCompareItem={onCompareItem} />
        </Section>
      )}

      <Section title={e.bulk_rerun_all_runs} tone="primary">
        <CohortRowList rows={items} onCompareItem={onCompareItem} />
      </Section>
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  sub: string;
  tone: string;
  icon?: React.ReactNode;
}

function SummaryCard({ label, value, sub, tone, icon }: SummaryCardProps) {
  return (
    <div className="bg-secondary/30 border border-primary/10 rounded-modal px-3 py-2">
      <div className="typo-code uppercase text-foreground tracking-wider">{label}</div>
      <div className={`typo-heading mt-1 flex items-center gap-1.5 ${tone}`}>
        {icon}
        <span>{value}</span>
      </div>
      <div className="typo-body text-foreground mt-0.5">{sub}</div>
    </div>
  );
}

interface KvCellProps {
  label: string;
  value: string;
  tone?: string;
}

function KvCell({ label, value, tone = 'text-foreground' }: KvCellProps) {
  return (
    <div className="px-3 py-2 bg-secondary/20 border border-primary/10 rounded-card">
      <div className="typo-code uppercase text-foreground tracking-wider">{label}</div>
      <div className={`typo-code mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}

interface SectionProps {
  title: string;
  tone: 'amber' | 'emerald' | 'primary';
  children: React.ReactNode;
}

function Section({ title, tone, children }: SectionProps) {
  const headerTone =
    tone === 'amber'
      ? 'text-amber-400'
      : tone === 'emerald'
        ? 'text-emerald-400'
        : 'text-foreground';
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`typo-heading uppercase tracking-wider ${headerTone}`}>{title}</span>
      </div>
      {children}
    </div>
  );
}

interface CohortRowListProps {
  rows: BulkRunItem[];
  onCompareItem: (originalId: string, newExecutionId: string) => void;
}

function CohortRowList({ rows, onCompareItem }: CohortRowListProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  return (
    <div className="rounded-modal border border-primary/10 overflow-hidden">
      {rows.map((it) => {
        const costDelta = it.newCost !== null ? it.newCost - it.origCost : null;
        const costTone = costDelta === null ? 'text-foreground' : deltaTone(costDelta, true);
        const canDrill = !!it.newExecutionId;
        return (
          <div
            key={it.originalId}
            className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-primary/5 bg-background/30 hover:bg-secondary/20 transition-colors"
          >
            <div className="col-span-3 flex items-center gap-2 typo-code text-foreground/90">
              <span>#{it.originalId.slice(0, 8)}</span>
              <span className="text-foreground">→</span>
              {it.newExecutionId ? (
                <span className="text-foreground/90">#{it.newExecutionId.slice(0, 8)}</span>
              ) : (
                <span className="text-foreground">—</span>
              )}
            </div>
            <div className="col-span-3 flex items-center gap-1.5 typo-body">
              <span className="text-foreground">{it.origStatus}</span>
              <span className="text-foreground">→</span>
              <span className="text-foreground/95">{it.newStatus ?? '—'}</span>
            </div>
            <div className="col-span-2 typo-code text-foreground/90 flex items-center">
              {it.newDurationMs !== null && it.origDurationMs !== null
                ? `${formatDuration(it.origDurationMs)} → ${formatDuration(it.newDurationMs)}`
                : '—'}
            </div>
            <div className={`col-span-2 typo-code flex items-center ${costTone}`}>
              {it.newCost !== null
                ? `${fmtCost(it.origCost)} → ${fmtCost(it.newCost)}`
                : fmtCost(it.origCost)}
            </div>
            <div className="col-span-2 flex items-center justify-end">
              {canDrill && (
                <button
                  onClick={() => onCompareItem(it.originalId, it.newExecutionId!)}
                  className="flex items-center gap-1 px-2 py-0.5 typo-body rounded-card text-primary/90 hover:bg-primary/10 transition-colors"
                  title={e.bulk_rerun_open_diff}
                >
                  {e.bulk_rerun_diff}
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
