export interface TemplatePerformance {
  review_id: string;
  total_adoptions: number;
  total_executions: number;
  success_rate: number;
  avg_cost_usd: number;
  positive_count: number;
  negative_count: number;
  top_positive_labels: string[];
  top_negative_labels: string[];
  derived_quality_score: number;
  /** False when one or more metric sub-queries failed and defaults were substituted. */
  data_available: boolean;
}
