import { useCallback, useRef, useState } from 'react';
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

  // Sequence guard: every click bumps the counter, and only the response
  // whose seq still matches the latest call is allowed to write to state.
  // Without this, clicking anomaly A then B before A returns lets A's data
  // resolve last and overwrite B's panel — the user sees B's metadata
  // paired with A's correlated events / root-cause, leading to wrong
  // root-cause conclusions during incident triage.
  const fetchSeqRef = useRef(0);

  const openDrilldown = useCallback(async (anomaly: MetricAnomaly, personaId?: string | null) => {
    const seq = ++fetchSeqRef.current;
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
      if (seq !== fetchSeqRef.current) return;
      setDrilldownData(data);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const closeDrilldown = useCallback(() => {
    // Bump seq so any in-flight fetch can't write into a closed panel.
    fetchSeqRef.current += 1;
    setSelectedAnomaly(null);
    setDrilldownData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { selectedAnomaly, drilldownData, loading, error, openDrilldown, closeDrilldown };
}
