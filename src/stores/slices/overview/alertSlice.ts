import type { StateCreator } from "zustand";
import type { PersonaStore } from "../../storeTypes";

// ── Alert Rule Types ──────────────────────────────────────────────────

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

// ── Alert metric display helpers ──────────────────────────────────────

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

// ── Persistence ───────────────────────────────────────────────────────

const RULES_KEY = '__personas_alert_rules';
const HISTORY_KEY = '__personas_alert_history';
const MAX_HISTORY = 200;

function loadRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRules(rules: AlertRule[]) {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules)); } catch { /* noop */ }
}

function loadHistory(): FiredAlert[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: FiredAlert[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); } catch { /* noop */ }
}

// ── Evaluation Engine ─────────────────────────────────────────────────

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

// ── Slice ─────────────────────────────────────────────────────────────

export interface AlertSlice {
  // State
  alertRules: AlertRule[];
  alertHistory: FiredAlert[];
  /** Alerts that are currently showing as toasts */
  activeToasts: FiredAlert[];

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

/** Track which rules already fired to avoid repeat alerts in the same session */
const firedRuleIds = new Set<string>();

export const createAlertSlice: StateCreator<PersonaStore, [], [], AlertSlice> = (set, get) => ({
  alertRules: loadRules(),
  alertHistory: loadHistory(),
  activeToasts: [],

  addAlertRule: (rule) => {
    const newRule: AlertRule = {
      ...rule,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    set((state) => {
      const rules = [...state.alertRules, newRule];
      saveRules(rules);
      return { alertRules: rules };
    });
  },

  updateAlertRule: (id, updates) => {
    set((state) => {
      const rules = state.alertRules.map(r => r.id === id ? { ...r, ...updates } : r);
      saveRules(rules);
      // Reset fired state so updated rule can fire again
      firedRuleIds.delete(id);
      return { alertRules: rules };
    });
  },

  deleteAlertRule: (id) => {
    set((state) => {
      const rules = state.alertRules.filter(r => r.id !== id);
      saveRules(rules);
      firedRuleIds.delete(id);
      return { alertRules: rules };
    });
  },

  toggleAlertRule: (id) => {
    set((state) => {
      const rules = state.alertRules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r);
      saveRules(rules);
      if (!rules.find(r => r.id === id)?.enabled) firedRuleIds.delete(id);
      return { alertRules: rules };
    });
  },

  dismissAlert: (alertId) => {
    set((state) => {
      const history = state.alertHistory.map(a => a.id === alertId ? { ...a, dismissed: true } : a);
      saveHistory(history);
      return { alertHistory: history };
    });
  },

  clearAlertHistory: () => {
    saveHistory([]);
    set({ alertHistory: [] });
  },

  dismissToast: (alertId) => {
    set((state) => ({ activeToasts: state.activeToasts.filter(t => t.id !== alertId) }));
  },

  evaluateAlertRules: () => {
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

    for (const rule of state.alertRules) {
      if (!rule.enabled) continue;
      if (firedRuleIds.has(rule.id)) continue;

      // For cost_spike, override snapshot to use today vs average
      const evalSnapshot = rule.metric === 'cost_spike'
        ? { ...snapshot, totalCostUsd: todayCost }
        : snapshot;

      const { triggered, value } = evaluateRule(rule, evalSnapshot);
      if (triggered) {
        firedRuleIds.add(rule.id);
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

    if (newAlerts.length > 0) {
      set((state) => {
        const history = [...newAlerts, ...state.alertHistory].slice(0, MAX_HISTORY);
        saveHistory(history);
        return {
          alertHistory: history,
          activeToasts: [...state.activeToasts, ...newAlerts],
        };
      });
    }
  },
});
