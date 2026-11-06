import { DollarSign, Clock, Hash } from 'lucide-react';
import { formatMs, formatCost } from '../libs/useReplayState';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

/** Cost accumulator panel. */
export function ReplayCostPanel({
  accumulatedCost,
  totalCost,
  currentMs,
  totalMs,
  completedSteps,
  totalSteps,
}: {
  accumulatedCost: number;
  totalCost: number | null;
  currentMs: number;
  totalMs: number;
  completedSteps: number;
  totalSteps: number;
}) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const costPct = totalCost != null && totalCost > 0 ? (accumulatedCost / totalCost) * 100 : 0;
  const timePct = totalMs > 0 ? (currentMs / totalMs) * 100 : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-t border-hair bg-surface-1">
      {/* Cost + bar */}
      <div className="flex items-center gap-1.5 min-w-0">
        {accumulatedCost === 0 && (totalCost === 0 || totalCost == null) ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
            <ellipse cx="7" cy="9" rx="5" ry="2" fill="#10b981" fillOpacity="0.2" stroke="#10b981" strokeWidth="0.8" strokeOpacity="0.3" />
            <ellipse cx="7" cy="7" rx="5" ry="2" fill="#10b981" fillOpacity="0.15" stroke="#10b981" strokeWidth="0.8" strokeOpacity="0.25" />
            <ellipse cx="7" cy="5" rx="5" ry="2" fill="#10b981" fillOpacity="0.1" stroke="#10b981" strokeWidth="0.8" strokeOpacity="0.2" />
          </svg>
        ) : (
          <DollarSign className="w-3 h-3 text-status-success flex-shrink-0" />
        )}
        <span className="typo-code tabular-nums text-status-success truncate">
          {/* accumulatedCost is a proportional estimate derived from scrub
              position (see useReplayTimeline's accumulatedCost doc), not a
              measured per-step cost -- the "~" matches the same convention
              used for estimated_time/estimated_minutes elsewhere. totalCost
              is the real execution.cost_usd, so it renders unprefixed. */}
          ~{formatCost(accumulatedCost)}
        </span>
        <span className="typo-body text-ink-1 truncate">
          / {formatCost(totalCost)}
        </span>
        <div className="w-16 sm:w-[120px] h-1.5 bg-surface-2 rounded-full overflow-hidden flex-shrink-0">
          <div
            className="h-full bg-status-success/50 rounded-full transition-[width] duration-150"
            style={{ width: `${costPct}%` }}
          />
        </div>
      </div>

      {/* Time + percentage */}
      <div className="flex items-center gap-1.5 min-w-0">
        <Clock className="w-3 h-3 text-status-info flex-shrink-0" />
        <span className="typo-code tabular-nums text-status-info truncate">
          {formatMs(currentMs)}
        </span>
        <span className="typo-body text-ink-1">
          (<Numeric value={timePct} unit="percent" precision={0} />)
        </span>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-1.5 min-w-0">
        <Hash className="w-3 h-3 text-ink-1 flex-shrink-0" />
        <span className="typo-code tabular-nums text-ink-1">
          {tx(e.steps_count, { completed: completedSteps, total: totalSteps })}
        </span>
      </div>
    </div>
  );
}
