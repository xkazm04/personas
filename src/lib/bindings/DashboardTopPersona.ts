/** Top-N persona ranked by total spend. */
export interface DashboardTopPersona {
  persona_id: string;
  persona_name: string;
  total_cost: number;
  total_executions: number;
  avg_cost_per_exec: number;
}
