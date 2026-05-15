import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BulkRunItem, BulkRunCohort, BulkRunPhase } from '../../libs/useBulkRerun';

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

  return (
    <div
      className="animate-fade-slide-in flex flex-col gap-2 px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-modal"
      role="status"
      aria-live="polite"
      data-testid="bulk-rerun-strip"
    >
      <div className="flex items-center gap-3">
        <span className="typo-heading text-foreground">
          {isDone
            ? tx(e.bulk_rerun_strip_done, { success: cohort.successCount, total })
            : tx(e.bulk_rerun_strip_in_flight, { finished, total })}
        </span>
        <div className="flex-1 h-1.5 rounded-full bg-primary/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary/60 to-accent/60 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="typo-code text-foreground/80">{pct}%</span>
        {isDone ? (
          <button
            onClick={onOpenReport}
            className="px-2.5 py-1 typo-heading rounded-modal bg-primary/15 text-primary/90 border border-primary/25 hover:bg-primary/25 transition-colors"
          >
            {e.bulk_rerun_open_report}
          </button>
        ) : (
          <button
            onClick={onCancel}
            className="flex items-center gap-1 px-2 py-1 typo-body rounded-card text-foreground hover:text-foreground/95 hover:bg-secondary/40 transition-colors"
            title={e.bulk_rerun_cancel}
          >
            <X className="w-3 h-3" />
            {e.bulk_rerun_cancel}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1" aria-hidden>
        {items.map((it) => (
          <span
            key={it.originalId}
            className={`w-2 h-2 rounded-sm transition-colors ${
              it.status === 'success'
                ? 'bg-emerald-400/70'
                : it.status === 'failed'
                  ? 'bg-red-400/70'
                  : it.status === 'running'
                    ? 'bg-primary/60 animate-pulse'
                    : 'bg-primary/15'
            }`}
            title={`${it.originalId.slice(0, 8)} — ${it.status}`}
          />
        ))}
      </div>
    </div>
  );
}
