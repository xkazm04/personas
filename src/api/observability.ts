import { invoke } from "@tauri-apps/api/core";

import type { MetricsChartData } from "@/lib/bindings/MetricsChartData";
import type { MetricsSummary } from "@/lib/bindings/MetricsSummary";
import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";
import type { PromptAbTestResult } from "@/lib/bindings/PromptAbTestResult";
import type { PromptPerformanceData } from "@/lib/bindings/PromptPerformanceData";
import type { ExecutionDashboardData } from "@/lib/bindings/ExecutionDashboardData";

// ============================================================================
// Observability
// ============================================================================

export const getMetricsSummary = (days?: number, personaId?: string) =>
  invoke<MetricsSummary>("get_metrics_summary", {
    days: days ?? null,
    personaId: personaId ?? null,
  });

export const getMetricsChartData = (
  days?: number,
  personaId?: string,
) =>
  invoke<MetricsChartData>("get_metrics_chart_data", {
    days: days ?? null,
    personaId: personaId ?? null,
  });

export const getPromptVersions = (personaId: string, limit?: number) =>
  invoke<PersonaPromptVersion[]>("get_prompt_versions", {
    personaId,
    limit: limit ?? null,
  });

export const getAllMonthlySpend = () =>
  invoke<Array<import('@/lib/bindings/PersonaMonthlySpend').PersonaMonthlySpend>>("get_all_monthly_spend");

// ============================================================================
// Prompt Performance Dashboard
// ============================================================================

export const getPromptPerformance = (personaId: string, days?: number) =>
  invoke<PromptPerformanceData>("get_prompt_performance", {
    personaId,
    days: days ?? null,
  });

// ============================================================================
// Execution Metrics Dashboard
// ============================================================================

export const getExecutionDashboard = (days?: number) =>
  invoke<ExecutionDashboardData>("get_execution_dashboard", {
    days: days ?? null,
  });

// ============================================================================
// Prompt Lab
// ============================================================================

export const tagPromptVersion = (id: string, tag: string) =>
  invoke<PersonaPromptVersion>("tag_prompt_version", { id, tag });

export const rollbackPromptVersion = (versionId: string) =>
  invoke<PersonaPromptVersion>("rollback_prompt_version", { versionId });

export const getPromptErrorRate = (personaId: string, window?: number) =>
  invoke<number>("get_prompt_error_rate", {
    personaId,
    window: window ?? null,
  });

export const runPromptAbTest = (
  personaId: string,
  versionAId: string,
  versionBId: string,
  testInput?: string,
) =>
  invoke<PromptAbTestResult>("run_prompt_ab_test", {
    personaId,
    versionAId,
    versionBId,
    testInput: testInput ?? null,
  });
