import type { PersonaHealthSignal, CascadeLink } from '@/stores/slices/overview/personaHealthSlice';
import type { Translations } from '@/i18n/generated/types';

// ---------------------------------------------------------------------------
// Pure builders for the insight band. JSX-free so the panels stay
// presentational. Logic was lifted from the original PredictiveAlerts /
// BurnRate / Cascade components, which the Vitals Ledger consolidation retired.
// ---------------------------------------------------------------------------

export type AlertKind = 'budget' | 'failure' | 'healing' | 'critical';

export interface InsightAlert {
  id: string;
  severity: 'critical' | 'warning';
  kind: AlertKind;
  title: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
  metric: string;
}

export function buildAlerts(signals: PersonaHealthSignal[], t: Translations): InsightAlert[] {
  const pa = t.overview.predictive_alerts_extra;
  const alerts: InsightAlert[] = [];

  for (const s of signals) {
    if (s.projectedExhaustionDays !== null && s.projectedExhaustionDays <= 7) {
      alerts.push({
        id: `budget-${s.personaId}`,
        severity: s.projectedExhaustionDays <= 2 ? 'critical' : 'warning',
        kind: 'budget',
        title: s.projectedExhaustionDays === 0 ? pa.budget_exhausted : `Budget exhaustion in ${s.projectedExhaustionDays}d`,
        personaName: s.personaName, personaIcon: s.personaIcon, personaColor: s.personaColor,
        metric: `${(s.budgetRatio * 100).toFixed(0)}% used`,
      });
    }
    if (s.predictedFailureInDays !== null) {
      alerts.push({
        id: `failure-${s.personaId}`,
        severity: s.predictedFailureInDays <= 3 ? 'critical' : 'warning',
        kind: 'failure',
        title: `Failure spike predicted in ${s.predictedFailureInDays}d`,
        personaName: s.personaName, personaIcon: s.personaIcon, personaColor: s.personaColor,
        metric: `${s.successRate.toFixed(0)}% success`,
      });
    }
    if (s.healingFrequency > 3) {
      alerts.push({
        id: `healing-${s.personaId}`,
        severity: 'warning', kind: 'healing',
        title: pa.excessive_healing,
        personaName: s.personaName, personaIcon: s.personaIcon, personaColor: s.personaColor,
        metric: `${s.healingFrequency.toFixed(1)}/day`,
      });
    }
    if (s.grade === 'critical' && s.totalExecutions > 5) {
      alerts.push({
        id: `critical-${s.personaId}`,
        severity: 'critical', kind: 'critical',
        title: pa.critical_health,
        personaName: s.personaName, personaIcon: s.personaIcon, personaColor: s.personaColor,
        metric: `${s.heartbeatScore}/100`,
      });
    }
  }

  const order = { critical: 0, warning: 1 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export interface BurnProjection {
  totalDailyBurn: number;
  totalProjectedMonthly: number;
  atRisk: PersonaHealthSignal[];
  topBurners: PersonaHealthSignal[];
  activeCount: number;
}

export function buildBurn(signals: PersonaHealthSignal[]): BurnProjection {
  const active = signals.filter(s => s.totalExecutions > 0);
  return {
    totalDailyBurn: active.reduce((sum, s) => sum + s.dailyBurnRate, 0),
    totalProjectedMonthly: active.reduce((sum, s) => sum + s.projectedMonthlyCost, 0),
    atRisk: active.filter(s => s.projectedExhaustionDays !== null && s.projectedExhaustionDays <= 7),
    topBurners: [...active].sort((a, b) => b.dailyBurnRate - a.dailyBurnRate).slice(0, 5),
    activeCount: active.length,
  };
}

export function buildChains(links: CascadeLink[], signals: PersonaHealthSignal[]): PersonaHealthSignal[][] {
  if (links.length === 0) return [];
  const sigMap = new Map(signals.map(s => [s.personaId, s]));
  const adj = new Map<string, string[]>();
  for (const l of links) {
    const list = adj.get(l.sourcePersonaId) ?? [];
    list.push(l.targetPersonaId);
    adj.set(l.sourcePersonaId, list);
  }
  const targets = new Set(links.map(l => l.targetPersonaId));
  const roots = [...new Set(links.map(l => l.sourcePersonaId))].filter(id => !targets.has(id));

  const result: PersonaHealthSignal[][] = [];
  for (const root of roots) {
    const ids = [root];
    const seen = new Set([root]);
    let cur = root;
    while (true) {
      const next = adj.get(cur)?.[0];
      if (!next || seen.has(next)) break;
      ids.push(next); seen.add(next); cur = next;
    }
    if (ids.length > 1) {
      const chain = ids.map(id => sigMap.get(id)).filter((s): s is PersonaHealthSignal => !!s);
      if (chain.length > 1) result.push(chain);
    }
  }
  return result;
}
