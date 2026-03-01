import type { DashboardDailyPoint } from "./DashboardDailyPoint";
import type { DashboardTopPersona } from "./DashboardTopPersona";
import type { DashboardCostAnomaly } from "./DashboardCostAnomaly";

/** Combined response for the execution metrics dashboard. */
export interface ExecutionDashboardData {
  daily_points: DashboardDailyPoint[];
  top_personas: DashboardTopPersona[];
  cost_anomalies: DashboardCostAnomaly[];
  total_executions: number;
  total_cost: number;
  overall_success_rate: number;
  avg_latency_ms: number;
}
