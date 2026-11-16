import { Layers, X, TrendingDown, TrendingUp, ChevronRight } from 'lucide-react';
import { formatDuration, getStatusEntry } from '@/lib/utils/formatters';
import { fmtCost } from '../../libs/comparisonHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import type { BulkRunItem, BulkRunCohort } from '../../libs/useBulkRerun';
import { isFailedExecutionStatus } from '../../libs/executionStatus';
import Button from '@/features/shared/components/buttons/Button';

interface BulkRerunReportProps {
  cohort: BulkRunCohort;
  items: BulkRunItem[];
  onClose: () => void;
  onCompareItem: (originalId: string, newExecutionId: string) => void;
}

/** An absence, not a measurement. */
const EM_DASH = '—';

function deltaTone(delta: number | null, lowerIsBetter = true): string {
  if (delta === null || Math.abs(delta) < 1e-6) return 'text-ink-1';
  const good = lowerIsBetter ? delta < 0 : delta > 0;
  return good ? 'text-status-success' : 'text-status-warning';
}

export function BulkRerunReport({ cohort, items, onClose, onCompareItem }: BulkRerunReportProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;

  const successRate = cohort.total === 0
    ? 0
    : Math.round((cohort.successCount / cohort.total) * 100);
  const costDeltaTone = deltaTone(cohort.meanCostDelta, true);
  const durDeltaTone = deltaTone(cohort.meanDurationDeltaMs, true);
  const meanCost = cohort.meanCostDelta;
  const meanDur = cohort.meanDurationDeltaMs;

  const regressions = items.filter(
    (it) =>
      it.newStatus &&
      !isFailedExecutionStatus(it.origStatus) &&
      isFailedExecutionStatus(it.newStatus),
  );
  const recoveries = items.filter(
    (it) =>
      it.newStatus &&
      isFailedExecutionStatus(it.origStatus) &&
      !isFailedExecutionStatus(it.newStatus),
  );

  return (
    <div className="space-y-4" data-testid="bulk-rerun-report">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary/70" />
          <h3 className="typo-heading text-ink-1">{e.bulk_rerun_report_title}</h3>
        </div>
        <Button
          type="button"
          onClick={onClose}
          aria-label={e.bulk_rerun_close}
          variant="ghost"
          size="icon-sm"
          icon={<X className="w-4 h-4" />}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label={e.bulk_rerun_success_rate}
          value={`${successRate}%`}
          sub={tx(e.bulk_rerun_count_of_total, { n: cohort.successCount, total: cohort.total })}
          tone={successRate >= 50 ? 'text-status-success' : 'text-status-warning'}
        />
        <SummaryCard
          label={e.bulk_rerun_recovered}
          value={String(cohort.recoveredCount)}
          sub={e.bulk_rerun_recovered_sub}
          tone="text-status-success"
        />
        <SummaryCard
          label={e.bulk_rerun_regressions}
          value={String(cohort.regressionCount)}
          sub={e.bulk_rerun_regressions_sub}
          tone={cohort.regressionCount > 0 ? 'text-status-warning' : 'text-ink-1'}
        />
        <SummaryCard
          label={e.bulk_rerun_mean_cost_delta}
          value={meanCost === null ? EM_DASH : fmtCost(Math.abs(meanCost))}
          sub={meanCost === null ? EM_DASH : meanCost < 0 ? e.bulk_rerun_cheaper : meanCost > 0 ? e.bulk_rerun_pricier : e.bulk_rerun_no_change}
          tone={costDeltaTone}
          icon={meanCost !== null && meanCost < 0 ? <TrendingDown className="w-3 h-3" /> : meanCost !== null && meanCost > 0 ? <TrendingUp className="w-3 h-3" /> : null}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 typo-body">
        <KvCell label={e.bulk_rerun_total_cost_original} value={fmtCost(cohort.totalCostOriginal)}
          note={cohort.unpricedOriginalCount > 0 ? tx(e.bulk_rerun_unpriced_note, { n: cohort.unpricedOriginalCount }) : undefined}
        />
        <KvCell label={e.bulk_rerun_total_cost_new} value={fmtCost(cohort.totalCostNew)}
          note={cohort.unpricedNewCount > 0 ? tx(e.bulk_rerun_unpriced_note, { n: cohort.unpricedNewCount }) : undefined}
        />
        <KvCell
          label={e.bulk_rerun_mean_duration_delta}
          value={meanDur === null ? EM_DASH : formatDuration(Math.abs(meanDur))}
          tone={durDeltaTone}
        />
        <KvCell
          label={e.bulk_rerun_failed_count}
          value={String(cohort.failedCount)}
          tone={cohort.failedCount > 0 ? 'text-status-error' : 'text-ink-1'}
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
    <div className="bg-surface-1 border border-hair rounded-modal px-3 py-2">
      <div className="typo-eyebrow text-ink-1">{label}</div>
      <div className={`typo-heading mt-1 flex items-center gap-1.5 ${tone}`}>
        {icon}
        <span>{value}</span>
      </div>
      <div className="typo-body text-ink-1 mt-0.5">{sub}</div>
    </div>
  );
}

interface KvCellProps {
  label: string;
  value: string;
  tone?: string;
  /** Disclosure under the value, e.g. how many runs the total skipped. */
  note?: string;
}

function KvCell({ label, value, tone = 'text-ink-1', note }: KvCellProps) {
  return (
    <div className="px-3 py-2 bg-surface-1 border border-hair rounded-card">
      <div className="typo-eyebrow text-ink-1">{label}</div>
      <div className={`typo-code mt-0.5 ${tone}`}>{value}</div>
      {note && <div className="typo-body text-ink-1 mt-0.5">{note}</div>}
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
      ? 'text-status-warning'
      : tone === 'emerald'
        ? 'text-status-success'
        : 'text-ink-1';
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`typo-heading uppercase ${headerTone}`}>{title}</span>
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
    <div className="rounded-modal border border-hair overflow-hidden">
      {rows.map((it) => {
        // No delta without BOTH costs: an unrecorded original is not a $0
        // original, and subtracting from it would invent the whole saving.
        const costDelta =
          it.newCost !== null && it.origCost !== null ? it.newCost - it.origCost : null;
        const costTone = costDelta === null ? 'text-ink-1' : deltaTone(costDelta, true);
        const canDrill = !!it.newExecutionId;
        return (
          <div
            key={it.originalId}
            className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-hair bg-background/30 hover:bg-surface-1 transition-colors"
          >
            <div className="col-span-3 flex items-center gap-2 typo-code text-ink-1">
              <span>#{it.originalId.slice(0, 8)}</span>
              <span className="text-ink-1">→</span>
              {it.newExecutionId ? (
                <span className="text-ink-1">#{it.newExecutionId.slice(0, 8)}</span>
              ) : (
                <span className="text-ink-1">—</span>
              )}
            </div>
            <div className="col-span-3 flex items-center gap-1.5 typo-body">
              <span className="text-ink-1">{getStatusEntry(it.origStatus).label}</span>
              <span className="text-ink-1">→</span>
              {/* A dispatched-but-not-yet-landed re-run has no status, cost or
                  duration yet — say "running", never a dash that reads as
                  "nothing happened" next to a $0.00 cost column. */}
              <span className="text-ink-1">
                {(it.newStatus !== null ? getStatusEntry(it.newStatus).label : null) ??
                  (it.status === 'timed_out'
                    ? e.bulk_rerun_timed_out_state
                    : it.status === 'cancelled'
                      ? e.bulk_rerun_cancelled_state
                      : it.status === 'pending' || it.status === 'running'
                        ? e.running_state
                        : '—')}
              </span>
            </div>
            <div className="col-span-2 typo-code text-ink-1 flex items-center">
              {it.newDurationMs !== null && it.origDurationMs !== null
                ? `${formatDuration(it.origDurationMs)} → ${formatDuration(it.newDurationMs)}`
                : '—'}
            </div>
            <div className={`col-span-2 typo-code flex items-center ${costTone}`}>
              {it.newCost !== null
                ? `${fmtCost(it.origCost ?? null)} → ${fmtCost(it.newCost)}`
                : fmtCost(it.origCost ?? null)}
            </div>
            <div className="col-span-2 flex items-center justify-end">
              {canDrill && (
                <Button
                  type="button"
                  onClick={() => onCompareItem(it.originalId, it.newExecutionId!)}
                  tooltip={e.bulk_rerun_open_diff}
                  variant="ghost"
                  size="xs"
                >
                  {e.bulk_rerun_diff}
                  <ChevronRight className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
