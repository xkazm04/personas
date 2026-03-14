import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";

// -- Alert Rule Types --------------------------------------------------

export type AlertMetric = 'error_rate' | 'success_rate' | 'cost' | 'cost_spike' | 'executions';
export type AlertOperator = '>' | '<' | '>=' | '<=';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  severity: AlertSeverity;
  /** null = global rule, string = persona-specific */
  personaId: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface FiredAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  metric: AlertMetric;
  severity: AlertSeverity;
  message: string;
  value: number;
  threshold: number;
  personaId: string | null;
  firedAt: string;
  dismissed: boolean;
}

// -- Alert metric display helpers --------------------------------------

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

// -- Evaluation Engine -------------------------------------------------

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

// -- Evaluation Health -------------------------------------------------

export interface AlertEvalHealth {
  /** ISO timestamp of last successful evaluation */
  lastEvalAt: string | null;
  /** Duration of last evaluation in ms */
  lastEvalDurationMs: number | null;
  /** Number of rules evaluated in last pass */
  rulesEvaluated: number;
  /** Number of rules that triggered in last pass */
  rulesTriggered: number;
  /** Last evaluation error message, null if healthy */
  lastError: string | null;
  /** Total evaluation failures since session start */
  totalFailures: number;
}

// -- Slice -------------------------------------------------------------

export interface AlertSlice {
  // State
  alertRules: AlertRule[];
  alertHistory: FiredAlert[];
  /** Cooldown map: ruleId -> timestamp of last fire (persisted via Zustand) */
  alertFiredCooldowns: Record<string, number>;
  /** Alerts that are currently showing as toasts */
  activeToasts: FiredAlert[];
  /** Health telemetry for the alert evaluation pipeline */
  alertEvalHealth: AlertEvalHealth;

  // Rule CRUD
  addAlertRule: (rule: Omit<AlertRule, 'id' | 'createdAt'>) => void;
  updateAlertRule: (id: string, updates: Partial<Omit<AlertRule, 'id' | 'createdAt'>>) => void;
  deleteAlertRule: (id: string) => void;
  toggleAlertRule: (id: string) => void;

  // Alert history
  dismissAlert: (alertId: string) => void;
  clearAlertHistory: () => void;
  dismissToast: (alertId: string) => void;

  // Evaluation
  evaluateAlertRules: () => void;
}

/** Cooldown window to avoid repeat alerts for the same rule. */
const FIRED_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export const createAlertSlice: StateCreator<OverviewStore, [], [], AlertSlice> = (set, get) => ({
  alertRules: [],
  alertHistory: [],
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

  addAlertRule: (rule) => {
    const newRule: AlertRule = {
      ...rule,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ alertRules: [...state.alertRules, newRule] }));
  },

  updateAlertRule: (id, updates) => {
    set((state) => {
      const rules = state.alertRules.map(r => r.id === id ? { ...r, ...updates } : r);
      const { [id]: _, ...rest } = state.alertFiredCooldowns;
      return { alertRules: rules, alertFiredCooldowns: rest };
    });
  },

  deleteAlertRule: (id) => {
    set((state) => {
      const rules = state.alertRules.filter(r => r.id !== id);
      const { [id]: _, ...rest } = state.alertFiredCooldowns;
      return { alertRules: rules, alertFiredCooldowns: rest };
    });
  },

  toggleAlertRule: (id) => {
    set((state) => {
      const rules = state.alertRules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r);
      const toggled = rules.find(r => r.id === id);
      if (toggled && !toggled.enabled) {
        const { [id]: _, ...rest } = state.alertFiredCooldowns;
        return { alertRules: rules, alertFiredCooldowns: rest };
      }
      return { alertRules: rules };
    });
  },

  dismissAlert: (alertId) => {
    set((state) => ({
      alertHistory: state.alertHistory.map(a => a.id === alertId ? { ...a, dismissed: true } : a),
    }));
  },

  clearAlertHistory: () => {
    set({ alertHistory: [] });
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

      // Compute average daily cost for cost_spike comparison
      const avgDailyCost = chartData.length > 0
        ? chartData.reduce((sum, p) => sum + p.cost, 0) / chartData.length
        : 0;

      // Today's cost (last data point) for spike detection
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

        // Check cooldown
        const firedTs = cooldowns[rule.id];
        if (firedTs != null) {
          if (now - firedTs < FIRED_COOLDOWN_MS) continue;
          delete cooldowns[rule.id];
        }

        rulesEvaluated++;

        // For cost_spike, override snapshot to use today vs average
        const evalSnapshot = rule.metric === 'cost_spike'
          ? { ...snapshot, totalCostUsd: todayCost }
          : snapshot;

        const { triggered, value } = evaluateRule(rule, evalSnapshot);
        if (triggered) {
          rulesTriggered++;
          cooldowns[rule.id] = now;
          const alert: FiredAlert = {
            id: crypto.randomUUID(),
            ruleId: rule.id,
            ruleName: rule.name,
            metric: rule.metric,
            severity: rule.severity,
            message: formatAlertMessage(rule, value),
            value,
            threshold: rule.threshold,
            personaId: rule.personaId,
            firedAt: new Date().toISOString(),
            dismissed: false,
          };
          newAlerts.push(alert);
        }
      }

      const durationMs = Math.round(performance.now() - startMs);

      if (newAlerts.length > 0) {
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
