import type { MetricsChartData } from './MetricsChartData';
import type { MetricsSummary } from './MetricsSummary';

export interface ObservabilityMetrics {
  summary: MetricsSummary;
  chartData: MetricsChartData;
}
