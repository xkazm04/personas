import { describe, it, expect, beforeEach } from "vitest";
import { mockInvoke, mockInvokeError, resetInvokeMocks } from "@/test/tauriMock";
import {
  getMetricsSummary,
  getMetricsChartData,
  getPromptVersions,
  getAllMonthlySpend,
  getPromptPerformance,
  getExecutionDashboard,
  tagPromptVersion,
  rollbackPromptVersion,
  getPromptErrorRate,
  listAlertRules,
  createAlertRule,
  deleteAlertRule,
  toggleAlertRule,
  listFiredAlerts,
  dismissFiredAlert,
  clearFiredAlerts,
} from "@/api/overview/observability";

describe("api/overview/observability", () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it("getMetricsSummary returns summary", async () => {
    const summary = { totalExecutions: 100, successRate: 0.95 };
    mockInvoke("get_metrics_summary", summary);
    expect(await getMetricsSummary(7)).toEqual(summary);
  });

  it("getMetricsChartData returns chart data", async () => {
    mockInvoke("get_metrics_chart_data", { labels: [], datasets: [] });
    expect(await getMetricsChartData(30, "p-1")).toEqual({ labels: [], datasets: [] });
  });

  it("getPromptVersions returns versions", async () => {
    mockInvoke("get_prompt_versions", [{ id: "pv-1" }]);
    expect(await getPromptVersions("p-1", 10)).toEqual([{ id: "pv-1" }]);
  });

  it("getAllMonthlySpend returns spend data", async () => {
    mockInvoke("get_all_monthly_spend", { periodStartUtc: "2026-03-01T00:00:00", items: [] });
    const result = await getAllMonthlySpend();
    expect(result.items).toEqual([]);
    expect(result.periodStartUtc).toBe("2026-03-01T00:00:00");
  });

  it("getPromptPerformance returns performance data", async () => {
    mockInvoke("get_prompt_performance", { avgLatency: 200 });
    expect(await getPromptPerformance("p-1", 7)).toEqual({ avgLatency: 200 });
  });

  it("getExecutionDashboard returns dashboard data", async () => {
    mockInvoke("get_execution_dashboard", { total: 0 });
    expect(await getExecutionDashboard(30)).toEqual({ total: 0 });
  });

  it("tagPromptVersion returns tagged version", async () => {
    mockInvoke("tag_prompt_version", { id: "pv-1", tag: "stable" });
    expect(await tagPromptVersion("pv-1", "stable")).toEqual({ id: "pv-1", tag: "stable" });
  });

  it("rollbackPromptVersion returns version", async () => {
    mockInvoke("rollback_prompt_version", { id: "pv-old" });
    expect(await rollbackPromptVersion("pv-old")).toEqual({ id: "pv-old" });
  });

  it("getPromptErrorRate returns number", async () => {
    mockInvoke("get_prompt_error_rate", 0.05);
    expect(await getPromptErrorRate("p-1", 24)).toBe(0.05);
  });

  it("listAlertRules returns rules", async () => {
    mockInvoke("list_alert_rules", [{ id: "ar-1" }]);
    expect(await listAlertRules()).toEqual([{ id: "ar-1" }]);
  });

  it("createAlertRule returns new rule", async () => {
    mockInvoke("create_alert_rule", { id: "ar-new" });
    const result = await createAlertRule({
      name: "High error rate",
      metric: "error_rate",
      operator: ">",
      threshold: 0.1,
      severity: "critical",
      persona_id: null,
      enabled: true,
    });
    expect(result).toEqual({ id: "ar-new" });
  });

  it("deleteAlertRule resolves", async () => {
    mockInvoke("delete_alert_rule", undefined);
    await expect(deleteAlertRule("ar-1")).resolves.toBeUndefined();
  });

  it("toggleAlertRule returns toggled rule", async () => {
    mockInvoke("toggle_alert_rule", { id: "ar-1", enabled: false });
    expect(await toggleAlertRule("ar-1")).toEqual({ id: "ar-1", enabled: false });
  });

  it("listFiredAlerts returns alerts", async () => {
    mockInvoke("list_fired_alerts", []);
    expect(await listFiredAlerts(50)).toEqual([]);
  });

  it("dismissFiredAlert resolves", async () => {
    mockInvoke("dismiss_fired_alert", undefined);
    await expect(dismissFiredAlert("fa-1")).resolves.toBeUndefined();
  });

  it("clearFiredAlerts resolves", async () => {
    mockInvoke("clear_fired_alerts", undefined);
    await expect(clearFiredAlerts()).resolves.toBeUndefined();
  });

  it("rejects on backend error", async () => {
    mockInvokeError("get_metrics_summary", "metrics unavailable");
    await expect(getMetricsSummary()).rejects.toThrow("metrics unavailable");
  });
});
