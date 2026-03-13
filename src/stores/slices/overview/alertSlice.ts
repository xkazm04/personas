import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { log } from "@/lib/log";

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

// -- Persistence -------------------------------------------------------

const RULES_KEY = '__personas_alert_rules';
const HISTORY_KEY = '__personas_alert_history';
const MAX_HISTORY = 200;

function loadRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    log.warn('alertSlice', 'Failed to parse alert rules from localStorage', { key: RULES_KEY, error: String(err) });
    return [];
  }
}

function saveRules(rules: AlertRule[]) {
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules)); } catch (err) { log.warn('alertSlice', 'Failed to persist alert rules', { key: RULES_KEY, error: String(err) }); }
}

function loadHistory(): FiredAlert[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    log.warn('alertSlice', 'Failed to parse alert history from localStorage', { key: HISTORY_KEY, error: String(err) });
    return [];
  }
}

function saveHistory(history: FiredAlert[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); } catch (err) { log.warn('alertSlice', 'Failed to persist alert history', { key: HISTORY_KEY, error: String(err) }); }
}

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

/** Track which rules already fired with a cooldown window to avoid repeat alerts.
 *  Persisted to localStorage so cooldowns survive page reloads. */
const FIRED_KEY = '__personas_alert_fired';
const FIRED_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function loadFiredMap(): Map<string, number> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    if (!raw) return new Map();
    const entries: [string, number][] = JSON.parse(raw);
    const now = Date.now();
    // Prune expired entries on load
    return new Map(entries.filter(([, ts]) => now - ts < FIRED_COOLDOWN_MS));
  } catch {
    return new Map();
  }
}

function saveFiredMap(map: Map<string, number>) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...map.entries()]));
  } catch { /* best-effort */ }
}

const firedRuleMap = loadFiredMap();

function hasFired(ruleId: string): boolean {
  const ts = firedRuleMap.get(ruleId);
  if (ts == null) return false;
  if (Date.now() - ts >= FIRED_COOLDOWN_MS) {
    firedRuleMap.delete(ruleId);
    saveFiredMap(firedRuleMap);
    return false;
  }
  return true;
}

function markFired(ruleId: string) {
  firedRuleMap.set(ruleId, Date.now());
  saveFiredMap(firedRuleMap);
}

function clearFired(ruleId: string) {
  firedRuleMap.delete(ruleId);
  saveFiredMap(firedRuleMap);
}

export const createAlertSlice: StateCreator<OverviewStore, [], [], AlertSlice> = (set, get) => ({
  alertRules: loadRules(),
  alertHistory: loadHistory(),
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
      clearFired(id);
      return { alertRules: rules };
    });
  },

  deleteAlertRule: (id) => {
    set((state) => {
      const rules = state.alertRules.filter(r => r.id !== id);
      saveRules(rules);
      clearFired(id);
      return { alertRules: rules };
    });
  },

  toggleAlertRule: (id) => {
    set((state) => {
      const rules = state.alertRules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r);
      saveRules(rules);
      if (!rules.find(r => r.id === id)?.enabled) clearFired(id);
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

      for (const rule of state.alertRules) {
        if (!rule.enabled) continue;
        if (hasFired(rule.id)) continue;
        rulesEvaluated++;

        // For cost_spike, override snapshot to use today vs average
        const evalSnapshot = rule.metric === 'cost_spike'
          ? { ...snapshot, totalCostUsd: todayCost }
          : snapshot;

        const { triggered, value } = evaluateRule(rule, evalSnapshot);
        if (triggered) {
          rulesTriggered++;
          markFired(rule.id);
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
          const history = [...newAlerts, ...state.alertHistory].slice(0, MAX_HISTORY);
          saveHistory(history);
          return {
            alertHistory: history,
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
      log.warn('alertSlice', 'evaluateAlertRules failed', { error: errorMsg, durationMs });
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
