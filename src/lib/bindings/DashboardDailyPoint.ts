import type { PersonaCostEntry } from "./PersonaCostEntry";

/** Daily-bucketed data point for the global execution metrics dashboard. */
export interface DashboardDailyPoint {
  date: string;
  total_cost: number;
  total_executions: number;
  completed: number;
  failed: number;
  success_rate: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
  persona_costs: PersonaCostEntry[];
}
