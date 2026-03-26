import { useCallback, useState } from 'react';
import { getAnomalyDrilldown } from '@/api/overview/observability';
import type { AnomalyDrilldownData } from '@/lib/bindings/AnomalyDrilldownData';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';

export interface AnomalyDrilldownState {
  /** The anomaly currently being drilled into (null = panel closed). */
  selectedAnomaly: MetricAnomaly | null;
  /** Drill-down data returned from the backend. */
  drilldownData: AnomalyDrilldownData | null;
  /** Whether a fetch is in progress. */
  loading: boolean;
  /** Error message from the last fetch. */
  error: string | null;
  /** Open the drill-down panel for a specific anomaly. */
  openDrilldown: (anomaly: MetricAnomaly, personaId?: string | null) => void;
  /** Close the drill-down panel. */
  closeDrilldown: () => void;
}

export function useAnomalyDrilldown(): AnomalyDrilldownState {
  const [selectedAnomaly, setSelectedAnomaly] = useState<MetricAnomaly | null>(null);
  const [drilldownData, setDrilldownData] = useState<AnomalyDrilldownData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDrilldown = useCallback(async (anomaly: MetricAnomaly, personaId?: string | null) => {
    setSelectedAnomaly(anomaly);
    setDrilldownData(null);
    setError(null);
    setLoading(true);
    try {
      const data = await getAnomalyDrilldown({
        anomalyDate: anomaly.date,
        anomalyMetric: anomaly.metric,
        anomalyValue: anomaly.value,
        anomalyBaseline: anomaly.baseline,
        anomalyDeviationPct: anomaly.deviation_pct,
        personaId,
      });
      setDrilldownData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const closeDrilldown = useCallback(() => {
    setSelectedAnomaly(null);
    setDrilldownData(null);
    setError(null);
  }, []);

  return { selectedAnomaly, drilldownData, loading, error, openDrilldown, closeDrilldown };
}
