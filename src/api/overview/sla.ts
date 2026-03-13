import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { SlaDashboardData } from "@/lib/bindings/SlaDashboardData";

export type { SlaDashboardData } from "@/lib/bindings/SlaDashboardData";
export type { PersonaSlaStats } from "@/lib/bindings/PersonaSlaStats";
export type { GlobalSlaStats } from "@/lib/bindings/GlobalSlaStats";
export type { HealingSummary } from "@/lib/bindings/HealingSummary";
export type { SlaDailyPoint } from "@/lib/bindings/SlaDailyPoint";

// ============================================================================
// Commands
// ============================================================================

export const getSlaDashboard = (days?: number) =>
  invoke<SlaDashboardData>("get_sla_dashboard", { days });
