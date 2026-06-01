import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AlertRule } from "@/lib/bindings/AlertRule";
import type { AlertMetric } from "@/lib/bindings/AlertMetric";
import type { AlertOperator } from "@/lib/bindings/AlertOperator";
import type { AlertSeverity } from "@/lib/bindings/AlertSeverity";
import type { FiredAlert } from "@/lib/bindings/FiredAlert";
import type { MetricsChartData } from "@/lib/bindings/MetricsChartData";
import type { MetricsSummary } from "@/lib/bindings/MetricsSummary";
import type { ValueRollup } from "@/lib/bindings/ValueRollup";
import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";
import type { PromptAbTestResult } from "@/lib/bindings/PromptAbTestResult";
import type { PromptPerformanceData } from "@/lib/bindings/PromptPerformanceData";
import type { ExecutionDashboardData } from "@/lib/bindings/ExecutionDashboardData";
import type { ExecutionHeatmapData } from "@/lib/bindings/ExecutionHeatmapData";
import type { AnomalyDrilldownData } from "@/lib/bindings/AnomalyDrilldownData";
import type { OverviewBundle } from "@/lib/bindings/OverviewBundle";

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

/**
 * Business-value + efficiency rollup. Omit personaId for the all-personas
 * headline; pass one to scope to a single persona.
 */
export const getValueRollup = (days?: number, personaId?: string) =>
  invoke<ValueRollup>("get_value_rollup", {
    days: days,
    personaId: personaId,
  });

export const getPromptVersions = (personaId: string, limit?: number) =>
  invoke<PersonaPromptVersion[]>("get_prompt_versions", {
    personaId,
    limit: limit,
  });

/** Batched: prompt versions for many personas in one IPC round-trip, keyed by
 *  persona id. Replaces N per-persona getPromptVersions calls. */
export const getPromptVersionsBulk = (personaIds: string[], limit?: number) =>
  invoke<Record<string, PersonaPromptVersion[]>>("get_prompt_versions_bulk", {
    personaIds,
    limit: limit,
  });

export const getAllMonthlySpend = () =>
  invoke<import('@/lib/bindings/MonthlySpendResult').MonthlySpendResult>("get_all_monthly_spend", {
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
  });

const overviewBundleCache = new Map<string, { expiresAt: number; promise: Promise<OverviewBundle> }>();
const OVERVIEW_BUNDLE_CACHE_MS = 1000;

export const getOverviewBundle = (days?: number, personaId?: string) => {
  const utcOffsetMinutes = -new Date().getTimezoneOffset();
  const key = `${days ?? 30}|${personaId ?? ""}|${utcOffsetMinutes}`;
  const now = Date.now();
  const cached = overviewBundleCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = invoke<OverviewBundle>("get_overview_bundle", {
    days,
    personaId,
    utcOffsetMinutes,
  }).catch((error) => {
    overviewBundleCache.delete(key);
    throw error;
  });
  overviewBundleCache.set(key, { expiresAt: now + OVERVIEW_BUNDLE_CACHE_MS, promise });
  return promise;
};

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
// Execution Heatmap (GitHub-style contribution graph)
// ============================================================================

export const getExecutionHeatmap = (days?: number, personaId?: string) =>
  invoke<ExecutionHeatmapData>("get_execution_heatmap", {
    days: days,
    personaId: personaId,
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
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  severity: AlertSeverity;
  persona_id: string | null;
  enabled: boolean;
}) => invoke<AlertRule>("create_alert_rule", { input });

export const updateAlertRule = (id: string, input: {
  name?: string;
  metric?: AlertMetric;
  operator?: AlertOperator;
  threshold?: number;
  severity?: AlertSeverity;
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

// ============================================================================
// Performance Digest
// ============================================================================

export const getDigestConfig = () =>
  invoke<import("@/lib/bindings/DigestConfig").DigestConfig>("get_digest_config");

export const setDigestConfig = (config: import("@/lib/bindings/DigestConfig").DigestConfig) =>
  invoke<import("@/lib/bindings/DigestConfig").DigestConfig>("set_digest_config", { config });

export const previewDigest = (days?: number) =>
  invoke<import("@/lib/bindings/PerformanceDigest").PerformanceDigest>("preview_digest", { days });

export const sendDigestNow = () =>
  invoke<void>("send_digest_now");
