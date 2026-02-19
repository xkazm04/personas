/** Shape returned by the `get_metrics_summary` Tauri command. */
export interface MetricsSummary {
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  total_cost_usd: number;
  active_personas: number;
  period_days: number;
}
