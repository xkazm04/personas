import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BulkRunItem, BulkRunCohort, BulkRunPhase } from '../../libs/useBulkRerun';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface BulkRerunStripProps {
  phase: BulkRunPhase;
  items: BulkRunItem[];
  cohort: BulkRunCohort;
  onCancel: () => void;
  onOpenReport: () => void;
}

export function BulkRerunStrip({ phase, items, cohort, onCancel, onOpenReport }: BulkRerunStripProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  if (phase === 'idle' || items.length === 0) return null;

  const finished = cohort.successCount + cohort.failedCount;
  const total = items.length;
  const pct = total === 0 ? 0 : Math.round((finished / total) * 100);
  const isDone = phase === 'completed';
  const stopped = cohort.timedOutCount + cohort.cancelledCount;

  return (
    <div
      className="animate-fade-slide-in flex flex-col gap-2 px-3 py-2.5 bg-surface-1 border border-hair rounded-modal"
      role="status"
      aria-live="polite"
      data-testid="bulk-rerun-strip"
    >
      <div className="flex items-center gap-3">
        <span className="typo-heading text-ink-1">
          {isDone
            ? stopped > 0
              ? tx(e.bulk_rerun_strip_done_partial, { success: cohort.successCount, total, stopped })
              : tx(e.bulk_rerun_strip_done, { success: cohort.successCount, total })
            : tx(e.bulk_rerun_strip_in_flight, { finished, total })}
        </span>
        <div className="flex-1 h-1.5 rounded-full bg-surface-1 overflow-hidden">
          <div
            className="h-full bg-surface-1 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="typo-code text-ink-1">{pct}%</span>
        {isDone ? (
          <Button type="button" onClick={onOpenReport} variant="secondary" size="sm">{e.bulk_rerun_open_report}</Button>
        ) : (
          <Button
            type="button"
            onClick={onCancel}
            tooltip={e.bulk_rerun_cancel}
            variant="ghost"
            size="xs"
            icon={<X className="w-3 h-3" />}
          >{e.bulk_rerun_cancel}</Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1" aria-hidden>
        {items.map((it) => (
          <Tooltip content={`${it.originalId.slice(0, 8)} — ${it.status}`}><span
            key={it.originalId}
            className={`w-2 h-2 rounded-interactive transition-colors ${
              it.status === 'success'
                ? 'bg-status-success/70'
                : it.status === 'failed'
                  ? 'bg-status-error/70'
                  : it.status === 'timed_out' || it.status === 'cancelled'
                    ? 'bg-status-warning/70'
                    : it.status === 'running'
                    ? 'bg-primary/60 animate-pulse'
                    : 'bg-primary/15'
            }`} /></Tooltip>
        ))}
      </div>
    </div>
  );
}
