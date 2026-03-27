import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AlertRule } from "@/lib/bindings/AlertRule";
import type { FiredAlert } from "@/lib/bindings/FiredAlert";
import type { MetricsChartData } from "@/lib/bindings/MetricsChartData";
import type { MetricsSummary } from "@/lib/bindings/MetricsSummary";
import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";
import type { PromptAbTestResult } from "@/lib/bindings/PromptAbTestResult";
import type { PromptPerformanceData } from "@/lib/bindings/PromptPerformanceData";
import type { ExecutionDashboardData } from "@/lib/bindings/ExecutionDashboardData";
import type { AnomalyDrilldownData } from "@/lib/bindings/AnomalyDrilldownData";

// ============================================================================
// Observability
// ============================================================================

export const getMetricsSummary = (days?: number, personaId?: string) =>
  invoke<MetricsSummary>("get_metrics_summary", {
    days: days,
    personaId: personaId,
  });

export const getMetricsChartData = (
  days?: number,
  personaId?: string,
) =>
  invoke<MetricsChartData>("get_metrics_chart_data", {
    days: days,
    personaId: personaId,
  });

export const getPromptVersions = (personaId: string, limit?: number) =>
  invoke<PersonaPromptVersion[]>("get_prompt_versions", {
    personaId,
    limit: limit,
  });

export const getAllMonthlySpend = () =>
  invoke<import('@/lib/bindings/MonthlySpendResult').MonthlySpendResult>("get_all_monthly_spend", {
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
  });

// ============================================================================
// Prompt Performance Dashboard
// ============================================================================

export const getPromptPerformance = (personaId: string, days?: number) =>
  invoke<PromptPerformanceData>("get_prompt_performance", {
    personaId,
    days: days,
  });

// ============================================================================
// Execution Metrics Dashboard
// ============================================================================

export const getExecutionDashboard = (days?: number) =>
  invoke<ExecutionDashboardData>("get_execution_dashboard", {
    days: days,
  });

// ============================================================================
// Anomaly Drill-Down
// ============================================================================

export const getAnomalyDrilldown = (params: {
  anomalyDate: string;
  anomalyMetric: string;
  anomalyValue: number;
  anomalyBaseline: number;
  anomalyDeviationPct: number;
  personaId?: string | null;
}) =>
  invoke<AnomalyDrilldownData>("get_anomaly_drilldown", {
    anomalyDate: params.anomalyDate,
    anomalyMetric: params.anomalyMetric,
    anomalyValue: params.anomalyValue,
    anomalyBaseline: params.anomalyBaseline,
    anomalyDeviationPct: params.anomalyDeviationPct,
    personaId: params.personaId ?? null,
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
    window: window,
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
    testInput: testInput,
  });

// ============================================================================
// Alert Rules (backend-persisted)
// ============================================================================

export const listAlertRules = () =>
  invoke<AlertRule[]>("list_alert_rules");

export const createAlertRule = (input: {
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  severity: string;
  persona_id: string | null;
  enabled: boolean;
}) => invoke<AlertRule>("create_alert_rule", { input });

export const updateAlertRule = (id: string, input: {
  name?: string;
  metric?: string;
  operator?: string;
  threshold?: number;
  severity?: string;
  persona_id?: string | null;
  enabled?: boolean;
}) => invoke<AlertRule>("update_alert_rule", { id, input });

export const deleteAlertRule = (id: string) =>
  invoke<void>("delete_alert_rule", { id });

export const toggleAlertRule = (id: string) =>
  invoke<AlertRule>("toggle_alert_rule", { id });

// ============================================================================
// Fired Alerts (backend-persisted history)
// ============================================================================

export const listFiredAlerts = (limit?: number) =>
  invoke<FiredAlert[]>("list_fired_alerts", { limit });

export const createFiredAlert = (alert: FiredAlert) =>
  invoke<void>("create_fired_alert", { alert });

export const dismissFiredAlert = (id: string) =>
  invoke<void>("dismiss_fired_alert", { id });

export const clearFiredAlerts = () =>
  invoke<void>("clear_fired_alerts");
