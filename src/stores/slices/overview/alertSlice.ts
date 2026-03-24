import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { AlertRule } from "@/lib/bindings/AlertRule";
import type { FiredAlert } from "@/lib/bindings/FiredAlert";
import * as api from "@/api/overview/observability";

// -- Alert metric / severity display helpers (frontend-only constants) --------

export type AlertMetric = 'error_rate' | 'success_rate' | 'cost' | 'cost_spike' | 'executions';
export type AlertOperator = '>' | '<' | '>=' | '<=';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export { type AlertRule } from "@/lib/bindings/AlertRule";
export { type FiredAlert } from "@/lib/bindings/FiredAlert";

export const ALERT_METRIC_OPTIONS: { value: AlertMetric; label: string; unit: string }[] = [
  { value: 'error_rate', label: 'Error Rate', unit: '%' },
  { value: 'success_rate', label: 'Success Rate', unit: '%' },
  { value: 'cost', label: 'Total Cost', unit: '$' },
  { value: 'cost_spike', label: 'Cost vs. Average', unit: 'x' },
  { value: 'executions', label: 'Executions', unit: '' },
];

export const ALERT_SEVERITY_OPTIONS: { value: AlertSeverity; label: string; color: string }[] = [
  { value: 'info', label: 'Info', color: '#3b82f6' },
  { value: 'warning', label: 'Warning', color: '#f59e0b' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
];

export const MAX_ALERT_HISTORY = 200;

// -- Evaluation Engine (client-side, fires alerts to backend) ----------------

interface MetricsSnapshot {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalCostUsd: number;
  avgCostUsd: number;
}

function evaluateRule(rule: AlertRule, metrics: MetricsSnapshot): { triggered: boolean; value: number } {
  let value: number;
  switch (rule.metric) {
    case 'error_rate':
      value = metrics.totalExecutions > 0
        ? (metrics.failedExecutions / metrics.totalExecutions) * 100
        : 0;
      break;
    case 'success_rate':
      value = metrics.totalExecutions > 0
        ? (metrics.successfulExecutions / metrics.totalExecutions) * 100
        : 0;
      break;
    case 'cost':
      value = metrics.totalCostUsd;
      break;
    case 'cost_spike':
      value = metrics.avgCostUsd > 0 ? metrics.totalCostUsd / metrics.avgCostUsd : 0;
      break;
    case 'executions':
      value = metrics.totalExecutions;
      break;
    default:
      return { triggered: false, value: 0 };
  }

  let triggered = false;
  switch (rule.operator) {
    case '>': triggered = value > rule.threshold; break;
    case '<': triggered = value < rule.threshold; break;
    case '>=': triggered = value >= rule.threshold; break;
    case '<=': triggered = value <= rule.threshold; break;
  }
  return { triggered, value };
}

function formatAlertMessage(rule: AlertRule, value: number): string {
  const metricInfo = ALERT_METRIC_OPTIONS.find(m => m.value === rule.metric);
  const label = metricInfo?.label ?? rule.metric;
  const unit = metricInfo?.unit ?? '';
  const fmtValue = unit === '$' ? `$${value.toFixed(2)}` : unit === '%' ? `${value.toFixed(1)}%` : unit === 'x' ? `${value.toFixed(1)}x` : String(Math.round(value));
  const fmtThreshold = unit === '$' ? `$${rule.threshold}` : unit === '%' ? `${rule.threshold}%` : unit === 'x' ? `${rule.threshold}x` : String(rule.threshold);
  return `${label} is ${fmtValue} (threshold: ${rule.operator} ${fmtThreshold})`;
}

// -- Evaluation Health -------------------------------------------------------

export interface AlertEvalHealth {
  lastEvalAt: string | null;
  lastEvalDurationMs: number | null;
  rulesEvaluated: number;
  rulesTriggered: number;
  lastError: string | null;
  totalFailures: number;
}

// -- Slice -------------------------------------------------------------------

export interface AlertSlice {
  // State (fetched from backend)
  alertRules: AlertRule[];
  alertHistory: FiredAlert[];
  alertRulesLoading: boolean;
  alertHistoryLoading: boolean;

  // Ephemeral client-side state
  alertFiredCooldowns: Record<string, number>;
  activeToasts: FiredAlert[];
  alertEvalHealth: AlertEvalHealth;

  // Backend CRUD
  fetchAlertRules: () => Promise<void>;
  fetchAlertHistory: () => Promise<void>;
  addAlertRule: (rule: Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateAlertRule: (id: string, updates: Partial<Omit<AlertRule, 'id' | 'created_at' | 'updated_at'>>) => Promise<void>;
  deleteAlertRule: (id: string) => Promise<void>;
  toggleAlertRule: (id: string) => Promise<void>;

  // Alert history
  dismissAlert: (alertId: string) => Promise<void>;
  clearAlertHistory: () => Promise<void>;
  dismissToast: (alertId: string) => void;

  // Evaluation
  evaluateAlertRules: () => void;
}

/** Cooldown window to avoid repeat alerts for the same rule. */
const FIRED_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export const createAlertSlice: StateCreator<OverviewStore, [], [], AlertSlice> = (set, get) => ({
  alertRules: [],
  alertHistory: [],
  alertRulesLoading: false,
  alertHistoryLoading: false,
  alertFiredCooldowns: {},
  activeToasts: [],
  alertEvalHealth: {
    lastEvalAt: null,
    lastEvalDurationMs: null,
    rulesEvaluated: 0,
    rulesTriggered: 0,
    lastError: null,
    totalFailures: 0,
  },

  fetchAlertRules: async () => {
    set({ alertRulesLoading: true });
    try {
      const rules = await api.listAlertRules();
      set({ alertRules: rules, alertRulesLoading: false });
    } catch {
      set({ alertRulesLoading: false });
    }
  },

  fetchAlertHistory: async () => {
    set({ alertHistoryLoading: true });
    try {
      const history = await api.listFiredAlerts(MAX_ALERT_HISTORY);
      set({ alertHistory: history, alertHistoryLoading: false });
    } catch {
      set({ alertHistoryLoading: false });
    }
  },

  addAlertRule: async (rule) => {
    try {
      const created = await api.createAlertRule({
        name: rule.name,
        metric: rule.metric,
        operator: rule.operator,
        threshold: rule.threshold,
        severity: rule.severity,
        persona_id: rule.persona_id,
        enabled: rule.enabled,
      });
      set((state) => ({ alertRules: [created, ...state.alertRules] }));
    } catch {
      // Silently fail; user can retry
    }
  },

  updateAlertRule: async (id, updates) => {
    try {
      const updated = await api.updateAlertRule(id, {
        name: updates.name,
        metric: updates.metric,
        operator: updates.operator,
        threshold: updates.threshold,
        severity: updates.severity,
        persona_id: updates.persona_id,
        enabled: updates.enabled,
      });
      set((state) => {
        const rules = state.alertRules.map(r => r.id === id ? updated : r);
        const { [id]: _, ...rest } = state.alertFiredCooldowns;
        return { alertRules: rules, alertFiredCooldowns: rest };
      });
    } catch {
      // Silently fail
    }
  },

  deleteAlertRule: async (id) => {
    try {
      await api.deleteAlertRule(id);
      set((state) => {
        const rules = state.alertRules.filter(r => r.id !== id);
        const { [id]: _, ...rest } = state.alertFiredCooldowns;
        return { alertRules: rules, alertFiredCooldowns: rest };
      });
    } catch {
      // Silently fail
    }
  },

  toggleAlertRule: async (id) => {
    try {
      const toggled = await api.toggleAlertRule(id);
      set((state) => {
        const rules = state.alertRules.map(r => r.id === id ? toggled : r);
        if (!toggled.enabled) {
          const { [id]: _, ...rest } = state.alertFiredCooldowns;
          return { alertRules: rules, alertFiredCooldowns: rest };
        }
        return { alertRules: rules };
      });
    } catch {
      // Silently fail
    }
  },

  dismissAlert: async (alertId) => {
    try {
      await api.dismissFiredAlert(alertId);
      set((state) => ({
        alertHistory: state.alertHistory.map(a => a.id === alertId ? { ...a, dismissed: true } : a),
      }));
    } catch {
      // Silently fail
    }
  },

  clearAlertHistory: async () => {
    try {
      await api.clearFiredAlerts();
      set({ alertHistory: [] });
    } catch {
      // Silently fail
    }
  },

  dismissToast: (alertId) => {
    set((state) => ({ activeToasts: state.activeToasts.filter(t => t.id !== alertId) }));
  },

  evaluateAlertRules: () => {
    const startMs = performance.now();
    let rulesEvaluated = 0;
    let rulesTriggered = 0;

    try {
      const state = get();
      const metrics = state.observabilityMetrics;
      if (!metrics) return;

      const summary = metrics.summary;
      const chartData = metrics.chartData.chart_points;

      const avgDailyCost = chartData.length > 0
        ? chartData.reduce((sum, p) => sum + p.cost, 0) / chartData.length
        : 0;

      const todayCost = chartData.length > 0 ? chartData[chartData.length - 1]!.cost : 0;

      const snapshot: MetricsSnapshot = {
        totalExecutions: summary.total_executions,
        successfulExecutions: summary.successful_executions,
        failedExecutions: summary.failed_executions,
        totalCostUsd: summary.total_cost_usd,
        avgCostUsd: avgDailyCost,
      };

      const newAlerts: FiredAlert[] = [];
      const now = Date.now();
      const cooldowns = { ...state.alertFiredCooldowns };

      for (const rule of state.alertRules) {
        if (!rule.enabled) continue;

        const firedTs = cooldowns[rule.id];
        if (firedTs != null) {
          if (now - firedTs < FIRED_COOLDOWN_MS) continue;
          delete cooldowns[rule.id];
        }

        rulesEvaluated++;

        const evalSnapshot = rule.metric === 'cost_spike'
          ? { ...snapshot, totalCostUsd: todayCost }
          : snapshot;

        const { triggered, value } = evaluateRule(rule, evalSnapshot);
        if (triggered) {
          rulesTriggered++;
          cooldowns[rule.id] = now;
          const alert: FiredAlert = {
            id: crypto.randomUUID(),
            rule_id: rule.id,
            rule_name: rule.name,
            metric: rule.metric,
            severity: rule.severity,
            message: formatAlertMessage(rule, value),
            value,
            threshold: rule.threshold,
            persona_id: rule.persona_id,
            fired_at: new Date().toISOString(),
            dismissed: false,
          };
          newAlerts.push(alert);
        }
      }

      const durationMs = Math.round(performance.now() - startMs);

      if (newAlerts.length > 0) {
        // Persist each fired alert to backend (fire-and-forget)
        for (const alert of newAlerts) {
          api.createFiredAlert(alert).catch(() => {});
        }

        set((state) => {
          const history = [...newAlerts, ...state.alertHistory].slice(0, MAX_ALERT_HISTORY);
          return {
            alertHistory: history,
            alertFiredCooldowns: cooldowns,
            activeToasts: [...state.activeToasts, ...newAlerts],
            alertEvalHealth: {
              lastEvalAt: new Date().toISOString(),
              lastEvalDurationMs: durationMs,
              rulesEvaluated,
              rulesTriggered,
              lastError: null,
              totalFailures: state.alertEvalHealth.totalFailures,
            },
          };
        });
      } else {
        set((state) => ({
          alertFiredCooldowns: cooldowns,
          alertEvalHealth: {
            lastEvalAt: new Date().toISOString(),
            lastEvalDurationMs: durationMs,
            rulesEvaluated,
            rulesTriggered: 0,
            lastError: null,
            totalFailures: state.alertEvalHealth.totalFailures,
          },
        }));
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - startMs);
      const errorMsg = err instanceof Error ? err.message : String(err);
      set((state) => ({
        alertEvalHealth: {
          lastEvalAt: new Date().toISOString(),
          lastEvalDurationMs: durationMs,
          rulesEvaluated,
          rulesTriggered,
          lastError: errorMsg,
          totalFailures: state.alertEvalHealth.totalFailures + 1,
        },
      }));
    }
  },
});
