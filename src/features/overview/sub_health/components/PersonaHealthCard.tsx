import { useState } from 'react';
import { Heart, TrendingDown, TrendingUp, Minus, DollarSign, AlertTriangle, Clock, Wrench, ChevronDown, ChevronRight } from 'lucide-react';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import { HeartbeatIndicator } from './HeartbeatIndicator';

interface PersonaHealthCardProps {
  signal: PersonaHealthSignal;
}

const TREND_ICON = {
  improving: TrendingUp,
  stable: Minus,
  degrading: TrendingDown,
};

const TREND_COLOR = {
  improving: 'text-emerald-400',
  stable: 'text-zinc-400',
  degrading: 'text-red-400',
};

const GRADE_BORDER = {
  healthy: 'border-emerald-500/20 hover:border-emerald-500/40',
  degraded: 'border-amber-500/20 hover:border-amber-500/40',
  critical: 'border-red-500/20 hover:border-red-500/40',
  unknown: 'border-zinc-500/20 hover:border-zinc-500/40',
};

const GRADE_BG = {
  healthy: 'from-emerald-500/5',
  degraded: 'from-amber-500/5',
  critical: 'from-red-500/5',
  unknown: 'from-zinc-500/5',
};

export function PersonaHealthCard({ signal }: PersonaHealthCardProps) {
  const [expanded, setExpanded] = useState(false);
  const TrendIcon = TREND_ICON[signal.failureTrend];

  return (
    <div
      className={`relative rounded-xl border bg-gradient-to-br ${GRADE_BG[signal.grade]} to-transparent ${GRADE_BORDER[signal.grade]} bg-secondary/20 transition-all duration-200 cursor-pointer select-none`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header — always visible */}
      <div className="flex items-center gap-3 p-3">
        <HeartbeatIndicator score={signal.heartbeatScore} grade={signal.grade} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {signal.personaIcon && <span className="text-base">{signal.personaIcon}</span>}
            <h3 className="typo-heading text-foreground/90 truncate">{signal.personaName}</h3>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <TrendIcon className={`w-3 h-3 ${TREND_COLOR[signal.failureTrend]}`} />
            <span className={`text-xs ${TREND_COLOR[signal.failureTrend]}`}>
              {signal.failureTrend === 'improving' ? 'Improving' : signal.failureTrend === 'degrading' ? 'Degrading' : 'Stable'}
            </span>
            <span className="text-xs text-foreground/40 ml-1">{signal.successRate.toFixed(0)}% success</span>
          </div>
        </div>
        {expanded
          ? <ChevronDown className="w-4 h-4 text-foreground/40 flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-foreground/40 flex-shrink-0" />
        }
      </div>

      {/* Expandable content */}
      {expanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-3 pb-3 pt-0">
              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-2 border-t border-primary/10 pt-3">
                <MetricCell
                  icon={Heart}
                  label="Success"
                  value={`${signal.successRate.toFixed(1)}%`}
                  color={signal.successRate >= 90 ? 'text-emerald-400' : signal.successRate >= 70 ? 'text-amber-400' : 'text-red-400'}
                />
                <MetricCell
                  icon={DollarSign}
                  label="Burn"
                  value={`$${signal.dailyBurnRate.toFixed(2)}/d`}
                  color={signal.budgetRatio > 0.8 ? 'text-red-400' : signal.budgetRatio > 0.5 ? 'text-amber-400' : 'text-emerald-400'}
                />
                <MetricCell
                  icon={Wrench}
                  label="Healing"
                  value={`${signal.healingFrequency.toFixed(1)}/d`}
                  color={signal.healingFrequency > 2 ? 'text-red-400' : signal.healingFrequency > 0.5 ? 'text-amber-400' : 'text-emerald-400'}
                />
                <MetricCell
                  icon={AlertTriangle}
                  label="Rollbacks"
                  value={String(signal.rollbackCount)}
                  color={signal.rollbackCount > 2 ? 'text-red-400' : signal.rollbackCount > 0 ? 'text-amber-400' : 'text-emerald-400'}
                />
              </div>

              {/* Predictions */}
              {(signal.projectedExhaustionDays !== null || signal.predictedFailureInDays !== null) && (
                <div className="mt-3 pt-3 border-t border-primary/10 space-y-1.5">
                  {signal.projectedExhaustionDays !== null && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-amber-400" />
                      <span className="text-xs text-muted-foreground">
                        Budget exhaustion in{' '}
                        <span className={signal.projectedExhaustionDays <= 3 ? 'text-red-400 font-semibold' : signal.projectedExhaustionDays <= 7 ? 'text-amber-400 font-semibold' : 'text-foreground/80'}>
                          {signal.projectedExhaustionDays === 0 ? 'exhausted' : `${signal.projectedExhaustionDays}d`}
                        </span>
                      </span>
                    </div>
                  )}
                  {signal.predictedFailureInDays !== null && (
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                      <span className="text-xs text-muted-foreground">
                        Predicted failure spike in{' '}
                        <span className="text-red-400 font-semibold">{signal.predictedFailureInDays}d</span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  );
}

function MetricCell({ icon: Icon, label, value, color }: { icon: typeof Heart; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-secondary/30">
      <Icon className={`w-3 h-3 ${color} flex-shrink-0`} />
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground/60 leading-none">{label}</p>
        <p className={`typo-caption ${color} leading-tight`}>{value}</p>
      </div>
    </div>
  );
}
