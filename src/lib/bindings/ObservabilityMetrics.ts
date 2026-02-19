import type { MetricsSummary } from './MetricsSummary';
import type { PersonaMetricsSnapshot } from './PersonaMetricsSnapshot';

export interface ObservabilityMetrics {
  summary: MetricsSummary;
  timeSeries: PersonaMetricsSnapshot[];
}
