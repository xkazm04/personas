import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { AlertRule } from "@/lib/bindings/AlertRule";
import type { FiredAlert } from "@/lib/bindings/FiredAlert";
import type { AlertMetric } from "@/lib/bindings/AlertMetric";
import type { AlertSeverity } from "@/lib/bindings/AlertSeverity";
import * as api from "@/api/overview/observability";
import { useToastStore } from "@/stores/toastStore";

// -- Alert metric / severity display helpers (sourced from backend enums) -----

export type { AlertMetric } from "@/lib/bindings/AlertMetric";
export type { AlertOperator } from "@/lib/bindings/AlertOperator";
export type { AlertSeverity } from "@/lib/bindings/AlertSeverity";
export type { AlertRule } from "@/lib/bindings/AlertRule";
export type { FiredAlert } from "@/lib/bindings/FiredAlert";

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

  // TTL tracking for filter-independent fetches
  _alertRulesFetchedAt: number;
  _alertHistoryFetchedAt: number;

  // Ephemeral client-side state
  alertFiredCooldowns: Record<string, number>;
  activeToasts: FiredAlert[];
  alertEvalHealth: AlertEvalHealth;

  /** Alert IDs that were shown in the UI but failed to persist to the backend. */
  pendingSyncAlertIds: Set<string>;

  // Backend CRUD (pass force=true to bypass TTL guard)
  fetchAlertRules: (force?: boolean) => Promise<void>;
  fetchAlertHistory: (force?: boolean) => Promise<void>;
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

/** TTL for filter-independent fetches (alert rules & history). */
const ALERT_FETCH_TTL_MS = 60_000; // 60 seconds

export const createAlertSlice: StateCreator<OverviewStore, [], [], AlertSlice> = (set, get) => ({
  alertRules: [],
  alertHistory: [],
  alertRulesLoading: false,
  alertHistoryLoading: false,
  _alertRulesFetchedAt: 0,
  _alertHistoryFetchedAt: 0,
  alertFiredCooldowns: {},
  activeToasts: [],
  pendingSyncAlertIds: new Set<string>(),
  alertEvalHealth: {
    lastEvalAt: null,
    lastEvalDurationMs: null,
    rulesEvaluated: 0,
    rulesTriggered: 0,
    lastError: null,
    totalFailures: 0,
  },

  fetchAlertRules: async (force) => {
    if (!force && Date.now() - get()._alertRulesFetchedAt < ALERT_FETCH_TTL_MS) return;
    set({ alertRulesLoading: true });
    try {
      const rules = await api.listAlertRules();
      set({ alertRules: rules, alertRulesLoading: false, _alertRulesFetchedAt: Date.now() });
    } catch {
      set({ alertRulesLoading: false });
    }
  },

  fetchAlertHistory: async (force) => {
    if (!force && Date.now() - get()._alertHistoryFetchedAt < ALERT_FETCH_TTL_MS) return;
    set({ alertHistoryLoading: true });
    try {
      const history = await api.listFiredAlerts(MAX_ALERT_HISTORY);
      set({ alertHistory: history, alertHistoryLoading: false, _alertHistoryFetchedAt: Date.now() });
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().addToast(`Failed to create alert rule: ${msg}`, 'error');
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().addToast(`Failed to update alert rule: ${msg}`, 'error');
    }
  },

  deleteAlertRule: async (id) => {
    // Optimistic: remove from list immediately
    const prevRules = get().alertRules;
    const prevCooldowns = get().alertFiredCooldowns;
    set((state) => {
      const rules = state.alertRules.filter(r => r.id !== id);
      const { [id]: _, ...rest } = state.alertFiredCooldowns;
      return { alertRules: rules, alertFiredCooldowns: rest };
    });
    try {
      await api.deleteAlertRule(id);
    } catch (err) {
      // Revert optimistic removal
      set({ alertRules: prevRules, alertFiredCooldowns: prevCooldowns });
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().addToast(`Failed to delete alert rule: ${msg}`, 'error');
    }
  },

  toggleAlertRule: async (id) => {
    // Optimistic: flip enabled state immediately
    const prevRules = get().alertRules;
    set((state) => ({
      alertRules: state.alertRules.map(r =>
        r.id === id ? { ...r, enabled: !r.enabled } : r
      ),
    }));
    try {
      const toggled = await api.toggleAlertRule(id);
      // Reconcile with authoritative backend state
      set((state) => {
        const rules = state.alertRules.map(r => r.id === id ? toggled : r);
        if (!toggled.enabled) {
          const { [id]: _, ...rest } = state.alertFiredCooldowns;
          return { alertRules: rules, alertFiredCooldowns: rest };
        }
        return { alertRules: rules };
      });
    } catch (err) {
      // Revert optimistic toggle
      set({ alertRules: prevRules });
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().addToast(`Failed to toggle alert rule: ${msg}`, 'error');
    }
  },

  dismissAlert: async (alertId) => {
    try {
      await api.dismissFiredAlert(alertId);
      set((state) => ({
        alertHistory: state.alertHistory.map(a => a.id === alertId ? { ...a, dismissed: true } : a),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().addToast(`Failed to dismiss alert: ${msg}`, 'error');
    }
  },

  clearAlertHistory: async () => {
    try {
      await api.clearFiredAlerts();
      set({ alertHistory: [], pendingSyncAlertIds: new Set<string>() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().addToast(`Failed to clear alert history: ${msg}`, 'error');
    }
  },

  dismissToast: (alertId) => {
    set((state) => ({ activeToasts: state.activeToasts.filter(t => t.id !== alertId) }));
  },

  evaluateAlertRules: () => {
    const startMs = performance.now();
    let rulesEvaluated = 0;
    let rulesTriggered = 0;

    // Retry any alerts that failed to persist on a previous cycle
    {
      const { pendingSyncAlertIds, alertHistory } = get();
      if (pendingSyncAlertIds.size > 0) {
        const pendingAlerts = alertHistory.filter(a => pendingSyncAlertIds.has(a.id));
        for (const alert of pendingAlerts) {
          api.createFiredAlert(alert).then(() => {
            set((state) => {
              const pending = new Set(state.pendingSyncAlertIds);
              pending.delete(alert.id);
              return { pendingSyncAlertIds: pending };
            });
          }).catch(() => {
            // Will retry again on the next eval cycle
          });
        }
      }
    }

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
        totalExecutions: summary.totalExecutions,
        successfulExecutions: summary.successfulExecutions,
        failedExecutions: summary.failedExecutions,
        totalCostUsd: summary.totalCostUsd,
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
        // Optimistically update UI, then persist to backend
        set((state) => {
          const history = [...newAlerts, ...state.alertHistory].slice(0, MAX_ALERT_HISTORY);
          const pending = new Set(state.pendingSyncAlertIds);
          for (const a of newAlerts) pending.add(a.id);
          return {
            alertHistory: history,
            alertFiredCooldowns: cooldowns,
            activeToasts: [...state.activeToasts, ...newAlerts],
            pendingSyncAlertIds: pending,
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

        // Persist each fired alert — remove from pending on success
        for (const alert of newAlerts) {
          api.createFiredAlert(alert).then(() => {
            set((state) => {
              const pending = new Set(state.pendingSyncAlertIds);
              pending.delete(alert.id);
              return { pendingSyncAlertIds: pending };
            });
          }).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[alerts] Failed to persist fired alert ${alert.id}: ${msg}`);
            // Alert stays in pendingSyncAlertIds for retry on next eval cycle
          });
        }
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
