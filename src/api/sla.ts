import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// Types (mirrors Rust sla.rs)
// ============================================================================

export interface SlaDashboardData {
  persona_stats: PersonaSlaStats[];
  global: GlobalSlaStats;
  healing_summary: HealingSummary;
  daily_trend: SlaDailyPoint[];
}

export interface PersonaSlaStats {
  persona_id: string;
  persona_name: string;
  total_executions: number;
  successful: number;
  failed: number;
  cancelled: number;
  success_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  total_cost_usd: number;
  mtbf_seconds: number | null;
  consecutive_failures: number;
  auto_healed_count: number;
}

export interface GlobalSlaStats {
  total_executions: number;
  successful: number;
  failed: number;
  success_rate: number;
  avg_duration_ms: number;
  total_cost_usd: number;
  active_persona_count: number;
}

export interface HealingSummary {
  open_issues: number;
  auto_fixed_count: number;
  circuit_breaker_count: number;
  knowledge_patterns: number;
}

export interface SlaDailyPoint {
  date: string;
  total: number;
  successful: number;
  failed: number;
  success_rate: number;
}

// ============================================================================
// Commands
// ============================================================================

export const getSlaDashboard = (days?: number) =>
  invoke<SlaDashboardData>("get_sla_dashboard", { days });
