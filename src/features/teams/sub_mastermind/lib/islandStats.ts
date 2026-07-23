// Real per-island stats for the side columns (round: functional-module
// wiring). Replaces the round-8 mock for live projects: KPI attainment from
// the Factory rollup, live error counts from the bound monitoring credential,
// 30-day LLM spend from the bound tracing credential, and tests/auto/prod
// straight from the readiness passport. `muted` ("—") is the honest no-data
// tone — a stat with no wired sensor never fakes a number.
import type { AppPassport } from '@/features/teams/sub_factory/passport/passportModel';

import type { KpiRollup } from './dimRegistry';
import { monitoringSeverity, type MonitoringSummary } from './liveState';

export interface IslandStat {
  key: string;
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'info' | 'muted';
}

export const STAT_TONE_INK: Record<IslandStat['tone'], string> = {
  good: 'var(--status-success)',
  warn: 'var(--status-warning)',
  bad: 'var(--status-error)',
  info: 'var(--status-info)',
  muted: 'var(--status-neutral)',
};

const NONE = '—';

const scoreTone = (score: number): IslandStat['tone'] =>
  score >= 78 ? 'good' : score >= 55 ? 'info' : score >= 35 ? 'warn' : 'bad';

/** Six stats per island: L column = KPI / Errors / LLM$, R = Tests / Auto / Prod. */
export function buildIslandStats(
  p: AppPassport,
  extras: {
    kpi: KpiRollup | undefined;
    monitoring: MonitoringSummary | undefined;
    /** 30d LLM spend USD; null = wired but no rows; undefined = not wired/loaded. */
    llmSpend: number | null | undefined;
  },
): IslandStat[] {
  const { kpi, monitoring, llmSpend } = extras;

  // KPI attainment — share of active KPIs currently on track (the Factory
  // rollup the wall's warning badges use).
  const kpiStat: IslandStat = !kpi || kpi.total === 0
    ? { key: 'kpi', label: 'KPI', value: NONE, tone: 'muted' }
    : {
        key: 'kpi', label: 'KPI',
        value: `${Math.round(((kpi.total - kpi.off) / kpi.total) * 100)}%`,
        tone: kpi.off > 0 ? 'bad' : 'good',
      };

  // Live monitoring — unresolved issues from the bound credential (falls back
  // to the 24h event count when the issue count is indeterminate).
  const errStat: IslandStat = !monitoring
    ? { key: 'errors', label: 'Errors', value: NONE, tone: 'muted' }
    : {
        key: 'errors', label: 'Errors',
        value: String(monitoring.unresolvedIssues ?? monitoring.eventsLast24h),
        tone: monitoringSeverity(monitoring) === 'error' ? 'bad' : monitoringSeverity(monitoring) === 'warn' ? 'warn' : 'good',
      };

  // 30-day LLM spend via the bound tracing credential (LlmTrackingCell's sum).
  const llmStat: IslandStat = llmSpend == null
    ? { key: 'llm', label: 'LLM 30d', value: llmSpend === null ? '$0' : NONE, tone: llmSpend === null ? 'good' : 'muted' }
    : { key: 'llm', label: 'LLM 30d', value: `$${llmSpend >= 10 ? llmSpend.toFixed(0) : llmSpend.toFixed(2)}`, tone: 'info' };

  // Tests — coverage % when the passport knows it, else level progress.
  const tests = p.productionReadiness.tests;
  const testsStat: IslandStat = tests.coveragePct != null
    ? { key: 'tests', label: 'Tests', value: `${tests.coveragePct}%`, tone: tests.coveragePct >= 70 ? 'good' : tests.coveragePct >= 45 ? 'warn' : 'bad' }
    : tests.level === 'none'
      ? { key: 'tests', label: 'Tests', value: NONE, tone: 'muted' }
      : { key: 'tests', label: 'Tests', value: tests.level, tone: tests.level === 'comprehensive' || tests.level === 'substantial' ? 'good' : 'warn' };

  return [
    kpiStat,
    errStat,
    llmStat,
    testsStat,
    { key: 'auto', label: 'Auto', value: `${p.automationReadiness.score}`, tone: scoreTone(p.automationReadiness.score) },
    { key: 'prod', label: 'Prod', value: `${p.productionReadiness.score}`, tone: scoreTone(p.productionReadiness.score) },
  ];
}
