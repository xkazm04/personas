// One hook, every dimension's Reading. It reads EXACTLY the sources
// MissionControlHome reads (the overview store the route's pipeline fills,
// useAttention, useStatusPageData) plus the four sources its cards fetched for
// themselves (useSideReadings). Nothing here fetches a source the page did not
// already reach.

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useOverviewStore } from '@/stores/overviewStore';
import { useAttention } from '@/hooks/useAttention';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/libs/metricIdentity';
import { useStatusPageData } from '@/features/overview/sub_health/libs/useStatusPageData';
import type { CompositeHealthEntry } from '@/features/overview/sub_health/libs/compositeHealthScore';
import { useSideReadings, SCHEDULE_TRIGGER_TYPES } from './useSideReadings';
import {
  pipelineReading,
  type AgentHealth, type Autonomy, type DayPoint, type Instruments, type Outcomes,
  type Queue, type Reading, type Recovery, type Spend, type Vault,
} from './readings';

export interface MissionReadings {
  outcomes: Reading<Outcomes>;
  spend: Reading<Spend>;
  agents: Reading<AgentHealth>;
  recovery: Reading<Recovery>;
  queue: Reading<Queue>;
  autonomy: Reading<Autonomy>;
  vault: Reading<Vault>;
  instruments: Reading<Instruments>;
  /** Per-agent rows behind `agents`, worst first. */
  entries: CompositeHealthEntry[];
  /** Daily series in the active scope (persona-scoped when filtered). */
  points: DayPoint[];
  /** Days the backend flagged as cost anomalies (YYYY-MM-DD). */
  anomalyDates: string[];
  /** Future scheduled runs, soonest first (the routines card's own filter). */
  upcoming: { at: string; personaId: string }[];
}

const pct = (num: number, den: number) => {
  const p = resolveMetricPercent(SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions, { numerator: num, denominator: den });
  return p === null ? null : Math.round(p);
};

export function useMissionReadings(): MissionReadings {
  const s = useOverviewStore(useShallow((st) => ({
    globalExecutions: st.globalExecutions,
    executionDashboard: st.executionDashboard,
    observabilityMetrics: st.observabilityMetrics,
    healingIssues: st.healingIssues,
    pipelineErrors: st.pipelineErrors,
    pipelineFetchedAt: st.pipelineFetchedAt,
  })));
  const { counts } = useAttention('dashboard');
  const { selectedPersonaId } = useOverviewFilterValues();
  const status = useStatusPageData();
  const side = useSideReadings();
  const { pipelineFetchedAt: at, pipelineErrors: err } = s;

  return useMemo(() => {
    const dash = s.executionDashboard;
    // Same scope rule as MissionControlHome's `vitals`: persona-scoped
    // observability when a persona is picked, the fleet's daily points otherwise.
    const scoped = selectedPersonaId && s.observabilityMetrics;
    const points: DayPoint[] = scoped
      ? s.observabilityMetrics!.chartData.chart_points.map((p) => ({ date: p.date, runs: p.executions, failed: p.failed, cost: p.cost, p95: 0 }))
      : (dash?.daily_points ?? []).map((p) => ({ date: p.date, runs: p.total_executions, failed: p.failed, cost: p.total_cost, p95: p.p95_duration_ms }));

    const execs = selectedPersonaId ? s.globalExecutions.filter((e) => e.personaId === selectedPersonaId) : s.globalExecutions;
    const runs = points.reduce((a, p) => a + p.runs, 0);
    const failed = points.reduce((a, p) => a + p.failed, 0);
    const successRate = scoped
      ? pct(s.observabilityMetrics!.summary.successfulExecutions, s.observabilityMetrics!.summary.totalExecutions)
      : pct(execs.filter((e) => e.status === 'completed').length, execs.length);
    const outcomes = pipelineReading<Outcomes>('globalExecutions', at, err, { successRate, runs, failed, points });

    const spend = pipelineReading<Spend>('executionDashboard', at, err, dash ? {
      total: dash.total_cost,
      burnRate: dash.burn_rate,
      anomalies: dash.cost_anomalies.length,
      avgLatencyMs: dash.avg_latency_ms,
    } : null);

    const entries = [...status.entries].sort((a, b) => a.score - b.score);
    const grade = (g: string) => entries.filter((e) => e.grade === g).length;
    const statusSettled = status.lastRefreshedAt !== null || status.error !== null;
    const agents: Reading<AgentHealth> = !statusSettled
      ? { status: 'pending' }
      : status.error && entries.length === 0
        ? { status: 'failed', error: status.error }
        : { status: 'ready', value: {
          score: status.globalScore, uptime: status.globalUptime,
          critical: grade('critical'), degraded: grade('degraded'), healthy: grade('healthy'), unknown: grade('unknown'),
          total: entries.length,
        } };

    const report = side.healing.status === 'ready' ? side.healing.value : null;
    const recovery = pipelineReading<Recovery>('healingIssues', at, err, {
      open: s.healingIssues.filter((i) => i.status !== 'resolved').length,
      paused: s.healingIssues.filter((i) => i.is_circuit_breaker && i.status !== 'resolved').length,
      autoFixed: s.healingIssues.filter((i) => i.auto_fixed).length,
      holdRate: report && report.attempted > 0 ? report.success_rate : null,
    });

    const queue = pipelineReading<Queue>('alertHistory', at, err, {
      reviews: counts.pending_reviews, alerts: counts.active_alerts, memory: counts.memory_actions,
      reports: counts.unread_reports,
      total: counts.pending_reviews + counts.active_alerts + counts.memory_actions + counts.unread_reports,
    });

    const autonomy: Reading<Autonomy> = side.triggers.status !== 'ready'
      ? side.triggers
      : (() => {
        const now = Date.now();
        const sched = side.triggers.value.filter((t) => t.enabled && SCHEDULE_TRIGGER_TYPES.has(t.trigger_type));
        const next = sched.map((t) => t.next_trigger_at).filter((x): x is string => !!x && Date.parse(x) >= now).sort()[0] ?? null;
        const loop = side.loop.status === 'ready' ? side.loop.value : null;
        return { status: 'ready', value: {
          loopOn: loop ? loop.enabled : null,
          dispatchedToday: loop ? Number(loop.summary.dispatchedToday) : 0,
          scheduled: sched.length, nextAt: next,
        } };
      })();

    const vault: Reading<Vault> = side.audit.status !== 'ready' ? side.audit : { status: 'ready', value: {
      events: side.audit.value.length,
      failedRotations: side.audit.value.filter((e) => e.operation.startsWith('rotation') && e.operation.includes('fail')).length,
      lastAt: side.audit.value.map((e) => e.createdAt).sort().pop() ?? null,
    } };

    const stamps = Object.values(at).filter(Boolean);
    const instruments: Reading<Instruments> = { status: 'ready', value: {
      sources: Object.keys(at).length + Object.keys(err).filter((k) => at[k] === undefined).length,
      errors: Object.keys(err).length,
      lastSynced: stamps.length ? Math.max(...stamps) : null,
    } };

    const anomalyDates = (dash?.cost_anomalies ?? []).map((a) => a.date.slice(0, 10));
    const nowMs = Date.now();
    const upcoming = side.triggers.status !== 'ready' ? [] : side.triggers.value
      .filter((t) => t.enabled && SCHEDULE_TRIGGER_TYPES.has(t.trigger_type) && t.next_trigger_at && Date.parse(t.next_trigger_at) >= nowMs)
      .map((t) => ({ at: t.next_trigger_at!, personaId: t.persona_id }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    return { outcomes, spend, agents, recovery, queue, autonomy, vault, instruments, entries, points, anomalyDates, upcoming };
  }, [s, at, err, selectedPersonaId, status, counts, side.healing, side.loop, side.triggers, side.audit]);
}
