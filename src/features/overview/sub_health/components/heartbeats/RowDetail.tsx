import { Heart, DollarSign, Wrench, AlertTriangle, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import { SegmentedVitalsBar } from './primitives';
import { subScores, segLabels } from './model';

// ---------------------------------------------------------------------------
// Shared expandable row detail — a segmented vitals-breakdown bar (the
// composite score split into its four contributing dimensions), the four
// component-signal cells, plus the budget / failure predictions.
// ---------------------------------------------------------------------------

export function RowDetail({ signal }: { signal: PersonaHealthSignal }) {
  const { t } = useTranslation();
  const h = t.overview.health_extra;
  const segs = subScores(signal);
  const labels = segLabels(t);

  return (
    <div className="animate-fade-slide-in px-4 pb-3 pt-3 border-t border-primary/10">
      {/* Vitals breakdown — composite score split into its 4 dimensions */}
      <div className="mb-3">
        <SegmentedVitalsBar signal={signal} height="h-2" />
        <div className="grid grid-cols-4 gap-1 mt-1.5">
          {segs.map(seg => (
            <div key={seg.key} className="flex items-baseline justify-between gap-1 min-w-0">
              <span className="typo-caption text-foreground truncate">{labels[seg.key]}</span>
              <span className="typo-data tabular-nums text-foreground/90">{seg.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricCell
          icon={Heart}
          label={h.success}
          value={`${signal.successRate.toFixed(1)}%`}
          tone={signal.successRate >= 90 ? 'text-status-success' : signal.successRate >= 70 ? 'text-status-warning' : 'text-status-error'}
        />
        <MetricCell
          icon={DollarSign}
          label={h.burn}
          value={`$${signal.dailyBurnRate.toFixed(2)}/d`}
          tone={signal.budgetRatio > 0.8 ? 'text-status-error' : signal.budgetRatio > 0.5 ? 'text-status-warning' : 'text-status-success'}
        />
        <MetricCell
          icon={Wrench}
          label={h.healing}
          value={`${signal.healingFrequency.toFixed(1)}/d`}
          tone={signal.healingFrequency > 2 ? 'text-status-error' : signal.healingFrequency > 0.5 ? 'text-status-warning' : 'text-status-success'}
        />
        <MetricCell
          icon={AlertTriangle}
          label={h.rollbacks}
          value={String(signal.rollbackCount)}
          tone={signal.rollbackCount > 2 ? 'text-status-error' : signal.rollbackCount > 0 ? 'text-status-warning' : 'text-status-success'}
        />
      </div>

      {(signal.projectedExhaustionDays !== null || signal.predictedFailureInDays !== null) && (
        <div className="mt-3 pt-3 border-t border-primary/10 flex flex-col gap-1.5">
          {signal.projectedExhaustionDays !== null && (
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-status-warning" />
              <span className="typo-caption text-foreground">
                {h.budget_exhaustion}{' '}
                <span className={
                  signal.projectedExhaustionDays <= 3 ? 'text-status-error font-semibold'
                    : signal.projectedExhaustionDays <= 7 ? 'text-status-warning font-semibold'
                      : 'text-foreground'
                }>
                  {signal.projectedExhaustionDays === 0 ? h.exhausted : `${signal.projectedExhaustionDays}d`}
                </span>
              </span>
            </div>
          )}
          {signal.predictedFailureInDays !== null && (
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-status-error" />
              <span className="typo-caption text-foreground">
                {h.predicted_failure}{' '}
                <span className="text-status-error font-semibold">{signal.predictedFailureInDays}d</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCell({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-card bg-secondary/30">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <p className="typo-caption text-foreground leading-none">{label}</p>
        <p className={`typo-data ${tone} leading-tight mt-0.5`}>{value}</p>
      </div>
    </div>
  );
}
