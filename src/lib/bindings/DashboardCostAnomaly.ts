/** A cost anomaly detected via rolling-average deviation (>2 std deviations). */
export interface DashboardCostAnomaly {
  date: string;
  cost: number;
  moving_avg: number;
  std_dev: number;
  deviation_sigma: number;
  /** IDs of the costliest executions that drove the spike. */
  execution_ids: string[];
}
