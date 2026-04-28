import { AlertTriangle } from 'lucide-react';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';
import { fmtCost, fmtDate } from '../libs/executionMetricsHelpers';
import { useTranslation } from '@/i18n/useTranslation';

// -- Anomaly Badge ----------------------------------------------------

interface AnomalyBadgeProps {
  anomaly: DashboardCostAnomaly;
  onClickExecution?: (id: string) => void;
}

export function AnomalyBadge({ anomaly, onClickExecution }: AnomalyBadgeProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-modal border border-amber-500/25 bg-amber-500/10">
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
            <span className="typo-body text-foreground">{t.overview.metrics_cards.top_executions}</span>
            {anomaly.execution_ids.map((id) => (
              <button
                key={id}
                onClick={() => onClickExecution?.(id)}
                className="typo-code font-mono text-blue-400 hover:text-blue-300 underline decoration-blue-400/30"
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
    <div className="bg-background/95 border border-primary/20 rounded-modal px-3 py-2 shadow-elevation-3 backdrop-blur-sm">
      <p className="typo-body text-foreground mb-1">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 typo-body">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-foreground">{entry.name}:</span>
          <span className="font-mono text-foreground/90">{typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}</span>
        </div>
      ))}
    </div>
  );
}
