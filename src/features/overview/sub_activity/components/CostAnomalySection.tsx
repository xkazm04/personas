import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';
import { useAnomalyDrilldown } from '@/features/overview/sub_observability/libs/useAnomalyDrilldown';
import AnomalyDrilldownPanel from '@/features/overview/sub_observability/components/AnomalyDrilldownPanel';
import { costAnomalyToMetricAnomaly } from '../libs/executionMetricsHelpers';
import { AnomalyBadge } from './MetricsCards';

interface CostAnomalySectionProps {
  anomalies: DashboardCostAnomaly[];
  /** Park an execution id for the Activity list to open, and leave the wall. */
  onOpenExecution: (id: string) => void;
}

/**
 * The Activity wall's cost-spike lane.
 *
 * It used to list anomalies and stop there: the badge was not clickable and
 * the execution ids were buttons with no handler, so the most urgent row on
 * the dashboard was the one with no action. `get_anomaly_drilldown` already
 * existed - it was reachable only from the Observability tab - so both click
 * targets now land on paths the app already owns: the same drill-down panel,
 * and the same execution-detail modal the list opens.
 */
export function CostAnomalySection({ anomalies, onOpenExecution }: CostAnomalySectionProps) {
  const { t } = useTranslation();
  const drilldown = useAnomalyDrilldown();

  if (anomalies.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="typo-heading text-amber-400/80 flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3" /> {t.overview.activity.cost_anomalies}
      </h4>
      {anomalies.map((a, i) => (
        <AnomalyBadge
          key={`${a.date}-${i}`}
          anomaly={a}
          onOpenDrilldown={() => drilldown.openDrilldown(costAnomalyToMetricAnomaly(a))}
          onClickExecution={onOpenExecution}
        />
      ))}

      {drilldown.selectedAnomaly && (
        <AnomalyDrilldownPanel
          anomaly={drilldown.selectedAnomaly}
          data={drilldown.drilldownData}
          loading={drilldown.loading}
          error={drilldown.error}
          onClose={drilldown.closeDrilldown}
        />
      )}
    </div>
  );
}
