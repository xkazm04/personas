import {
  Clock, DollarSign, Target, FileText, Trophy,
} from 'lucide-react';
import { scoreColor } from '@/lib/eval/evalFramework';
import type { ModelOption, ModelMetrics } from './compareModels';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

export function MetricCard({
  model,
  metrics,
  isWinner,
  accent,
}: {
  model: ModelOption;
  metrics: ModelMetrics;
  isWinner: boolean;
  accent: 'blue' | 'amber';
}) {
  const borderColor = isWinner
    ? accent === 'blue' ? 'border-blue-500/30' : 'border-amber-500/30'
    : 'border-primary/10';
  const bgColor = isWinner
    ? accent === 'blue' ? 'bg-blue-500/5' : 'bg-amber-500/5'
    : 'bg-background/30';

  return (
    <div className={`px-3 py-2.5 rounded-modal border ${borderColor} ${bgColor} space-y-2`}>
      <div className="flex items-center gap-2">
        <span className="typo-heading font-semibold text-foreground/90">{model.label}</span>
        {isWinner && <Trophy className="w-3 h-3 text-primary" />}
      </div>

      <div className={`typo-data-lg font-bold tabular-nums ${scoreColor(metrics.composite)}`}>
        {metrics.composite}
      </div>

      <MetricCardRows metrics={metrics} />
    </div>
  );
}

function MetricCardRows({ metrics }: { metrics: ModelMetrics }) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 typo-caption">
      <MetricRow icon={Clock} label={mc.latency} value={`${(metrics.avgDuration / 1000).toFixed(1)}s`} />
      <MetricRow icon={DollarSign} label={mc.cost} value={`$${metrics.totalCost.toFixed(4)}`} />
      <MetricRow icon={Target} label={mc.tokens_in} value={metrics.totalInputTokens.toLocaleString()} />
      <MetricRow icon={FileText} label={mc.tokens_out} value={metrics.totalOutputTokens.toLocaleString()} />
    </div>
  );
}

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1 text-foreground">
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{label}:</span>
      <span className="text-foreground font-mono ml-auto">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare bar (horizontal dual bar)
// ---------------------------------------------------------------------------

export function CompareBar({
  label,
  labelIcon: Icon,
  valueA,
  valueB,
}: {
  label: string;
  labelIcon: typeof Target;
  valueA: number;
  valueB: number;
}) {
  const max = Math.max(valueA, valueB, 1);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 typo-caption text-foreground">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        {/* A bar (right-aligned, blue) */}
        <div className="flex-1 flex justify-end">
          <div className="h-2.5 rounded-full bg-blue-500/30 overflow-hidden" style={{ width: `${(valueA / max) * 100}%` }}>
            <div className="h-full bg-blue-500 rounded-full" style={{ width: '100%' }} />
          </div>
        </div>
        <div className="w-16 text-center typo-code font-mono tabular-nums">
          <span className={scoreColor(valueA)}>{valueA}</span>
          <span className="text-foreground mx-0.5">:</span>
          <span className={scoreColor(valueB)}>{valueB}</span>
        </div>
        {/* B bar (left-aligned, amber) */}
        <div className="flex-1">
          <div className="h-2.5 rounded-full bg-amber-500/30 overflow-hidden" style={{ width: `${(valueB / max) * 100}%` }}>
            <div className="h-full bg-amber-500 rounded-full" style={{ width: '100%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
