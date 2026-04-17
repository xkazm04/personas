import {
  DollarSign,
  Clock,
  Hash,
} from 'lucide-react';
import { formatMs, formatCost } from '../../libs/useReplayState';
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
  totalCost: number;
  currentMs: number;
  totalMs: number;
  completedSteps: number;
  totalSteps: number;
}) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const costPct = totalCost > 0 ? (accumulatedCost / totalCost) * 100 : 0;
  const timePct = totalMs > 0 ? (currentMs / totalMs) * 100 : 0;

  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-t border-primary/10 bg-secondary/20">
      {/* Cost */}
      <div className="flex items-center gap-1.5">
        <DollarSign className="w-3 h-3 text-emerald-400/60" />
        <span className="typo-code tabular-nums text-emerald-400">
          {formatCost(accumulatedCost)}
        </span>
        <span className="typo-body text-foreground">
          / {formatCost(totalCost)}
        </span>
      </div>

      {/* Cost bar */}
      <div className="flex-1 h-1.5 bg-secondary/50 rounded-full overflow-hidden max-w-[120px]">
        <div
          className="h-full bg-emerald-500/50 rounded-full transition-[width] duration-150"
          style={{ width: `${costPct}%` }}
        />
      </div>

      {/* Time */}
      <div className="flex items-center gap-1.5">
        <Clock className="w-3 h-3 text-blue-400/60" />
        <span className="typo-code tabular-nums text-blue-400">
          {formatMs(currentMs)}
        </span>
        <span className="typo-body text-foreground">
          ({timePct.toFixed(0)}%)
        </span>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-1.5">
        <Hash className="w-3 h-3 text-foreground" />
        <span className="typo-code tabular-nums text-foreground">
          {tx(e.steps_count, { completed: completedSteps, total: totalSteps })}
        </span>
      </div>
    </div>
  );
}
