import { DollarSign, AlertTriangle } from 'lucide-react';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { fmtCost, fmtDate } from '../libs/executionMetricsHelpers';
import { useTranslation } from '@/i18n/useTranslation';

// -- Summary Card -----------------------------------------------------

interface SummaryCardProps {
  icon: typeof DollarSign;
  label: string;
  value: string;
  color: string;
  /** Raw numeric value — when provided, the card animates from previous to current */
  numericValue?: number;
  /** Formatter for the animated number (required when numericValue is set) */
  formatFn?: (v: number) => string;
}

export function SummaryCard({ icon: Icon, label, value, color, numericValue, formatFn }: SummaryCardProps) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-400 bg-blue-500/15 border-blue-500/25',
    emerald: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25',
    violet: 'text-violet-400 bg-violet-500/15 border-violet-500/25',
    amber: 'text-amber-400 bg-amber-500/15 border-amber-500/25',
  };
  const c = colorMap[color] ?? colorMap.blue!;
  const parts = c.split(' ');
  const textColor = parts[0];
  const bg = parts[1];
  const border = parts[2];

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${border} ${bg}`}>
      <Icon className={`w-4 h-4 ${textColor}`} />
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground/70 truncate">{label}</p>
        <p className={`typo-heading ${textColor}`}>
          {numericValue != null && formatFn
            ? <AnimatedCounter value={numericValue} formatFn={formatFn} />
            : value}
        </p>
      </div>
    </div>
  );
}

// -- Anomaly Badge ----------------------------------------------------

interface AnomalyBadgeProps {
  anomaly: DashboardCostAnomaly;
  onClickExecution?: (id: string) => void;
}

export function AnomalyBadge({ anomaly, onClickExecution }: AnomalyBadgeProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-xl border border-amber-500/25 bg-amber-500/10">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="typo-heading text-amber-300">
          {fmtDate(anomaly.date)} -- Cost spike {fmtCost(anomaly.cost)}
          <span className="text-amber-400/70 ml-1">
            ({anomaly.deviation_sigma.toFixed(1)} above avg {fmtCost(anomaly.moving_avg)})
          </span>
        </p>
        {anomaly.execution_ids.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground/60">{t.overview.metrics_cards.top_executions}</span>
            {anomaly.execution_ids.map((id) => (
              <button
                key={id}
                onClick={() => onClickExecution?.(id)}
                className="text-sm font-mono text-blue-400 hover:text-blue-300 underline decoration-blue-400/30"
              >
                {id.slice(0, 8)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -- Chart Tooltip ----------------------------------------------------

export function ChartTooltipContent({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background/95 border border-primary/20 rounded-xl px-3 py-2 shadow-elevation-3 backdrop-blur-sm">
      <p className="text-sm text-muted-foreground/80 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground/70">{entry.name}:</span>
          <span className="font-mono text-foreground/90">{typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}</span>
        </div>
      ))}
    </div>
  );
}
