import { AlertTriangle } from 'lucide-react';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';
import { fmtCost, fmtDate } from '../libs/executionMetricsHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';
import { Numeric } from '@/features/shared/components/display/Numeric';


// -- Anomaly Badge ----------------------------------------------------

interface AnomalyBadgeProps {
  anomaly: DashboardCostAnomaly;
  onClickExecution?: (id: string) => void;
  /** Open the anomaly drill-down. Without it the row is static, not a dead button. */
  onOpenDrilldown?: () => void;
}

export function AnomalyBadge({ anomaly, onClickExecution, onOpenDrilldown }: AnomalyBadgeProps) {
  const { t } = useTranslation();
  const headline = (
    <>
      {fmtDate(anomaly.date)} <DebtText k="auto_cost_spike_a1385f95" /> {fmtCost(anomaly.cost)}
      <span className="text-status-warning ml-1">
(<Numeric value={anomaly.deviation_sigma} unit="plain" precision={1} /> <DebtText k="auto_above_avg_e49f3ce5" /> {fmtCost(anomaly.moving_avg)})
      </span>
    </>
  );
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-modal border border-status-warning/25 bg-status-warning/10">
      <AlertTriangle className="w-3.5 h-3.5 text-status-warning mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        {onOpenDrilldown ? (
          <button
            type="button"
            onClick={onOpenDrilldown}
            aria-label={t.overview.metrics_cards.open_anomaly_drilldown}
            className="typo-heading text-status-warning text-left hover:text-status-warning underline decoration-amber-400/30 cursor-pointer"
          >
            {headline}
          </button>
        ) : (
          <p className="typo-heading text-status-warning">{headline}</p>
        )}
        {anomaly.execution_ids.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className="typo-body text-foreground">{t.overview.metrics_cards.top_executions}</span>
            {anomaly.execution_ids.map((id) => (
              // An id with no handler is NOT a button: a control that looks
              // clickable and does nothing is worse than plain text.
              onClickExecution ? (
                <button
                  key={id}
                  type="button"
                  onClick={() => onClickExecution(id)}
                  className="typo-code text-status-info hover:text-status-info underline decoration-blue-400/30 cursor-pointer"
                >
                  {id.slice(0, 8)}
                </button>
              ) : (
                <span key={id} className="typo-code text-foreground">{id.slice(0, 8)}</span>
              )
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
    <div className="bg-background/95 border border-hair rounded-modal px-3 py-2 shadow-elevation-3 backdrop-blur-sm">
      <p className="typo-body text-foreground mb-1">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 typo-body">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-foreground">{entry.name}:</span>
          <span className="font-mono text-ink-2">{typeof entry.value === 'number' ? <Numeric value={entry.value} unit="plain" precision={2} /> : entry.value}</span>
        </div>
      ))}
    </div>
  );
}
