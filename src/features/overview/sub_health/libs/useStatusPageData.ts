import { useState, useEffect, useMemo, useCallback } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { useShallow } from 'zustand/react/shallow';
import { storeBus, AccessorKey } from '@/lib/storeBus';
import { getSlaDashboard } from '@/api/overview/sla';
import { listHealingIssues } from '@/api/overview/healing';
import { log } from '@/lib/log';
import type { PersonaSlaStats } from '@/lib/bindings/PersonaSlaStats';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { Persona } from '@/lib/bindings/Persona';
import { computeCompositeHealth, type CompositeHealthEntry } from './compositeHealthScore';

interface StatusPageState {
  entries: CompositeHealthEntry[];
  loading: boolean;
  /** Combined view of the hard fetch error plus either per-source error below —
   *  a rejected SLA or healing fetch surfaces here too, so a persistent
   *  failure is never silently indistinguishable from "all sources fresh". */
  error: string | null;
  /** Non-null only when the SLA dashboard fetch itself rejected this cycle. */
  slaError: string | null;
  /** Non-null only when the healing-issues fetch itself rejected this cycle. */
  healingError: string | null;
  lastRefreshedAt: number | null;
  /** null when there are no personas at all — a fresh install or fully-filtered
   *  view has no score to report, not a perfect 100. */
  globalScore: number | null;
  /** null when no persona in the set has any day with recorded activity. */
  globalUptime: number | null;
}

/**
 * Average composite score across personas, or null when there are none.
 * Extracted as a pure function so the "no personas at all" honesty fix is
 * unit-testable without mounting the hook (store/IPC free).
 */
export function computeGlobalScore(entries: CompositeHealthEntry[]): number | null {
  if (entries.length === 0) return null;
  return Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length);
}

/**
 * Average uptime across personas that have at least one day of recorded
 * activity, or null when none do. Personas with `uptimePercent === null`
 * (no activity in the 30-day window) are excluded from the average rather
 * than counted as either 0% or 100% uptime.
 */
export function computeGlobalUptime(entries: CompositeHealthEntry[]): number | null {
  const withData = entries.filter(
    (e): e is CompositeHealthEntry & { uptimePercent: number } => e.uptimePercent != null,
  );
  if (withData.length === 0) return null;
  return withData.reduce((s, e) => s + e.uptimePercent, 0) / withData.length;
}

export function useStatusPageData() {
  const { executionDashboard, fetchExecutionDashboard } = useOverviewStore(
    useShallow((s) => ({
      executionDashboard: s.executionDashboard,
      fetchExecutionDashboard: s.fetchExecutionDashboard,
    })),
  );

  const [slaStats, setSlaStats] = useState<PersonaSlaStats[]>([]);
  const [healingIssues, setHealingIssues] = useState<PersonaHealingIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-source errors — a rejected SLA or healing fetch previously vanished
  // (Promise.allSettled only read the `fulfilled` branch), leaving `error`
  // null and every persona rendering as a silent stale/'unknown' entry with
  // no indication anything failed. These are surfaced through the combined
  // `error` below (so the existing InlineErrorBanner picks them up without
  // any consumer change) and also exposed individually for callers that want
  // to attribute which source is degraded.
  const [slaError, setSlaError] = useState<string | null>(null);
  const [healingError, setHealingError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Ensure dashboard data is fresh
      await fetchExecutionDashboard();

      const [slaResult, healingResult] = await Promise.allSettled([
        getSlaDashboard(30),
        listHealingIssues(),
      ]);

      if (slaResult.status === 'fulfilled') {
        setSlaStats(slaResult.value.persona_stats);
        setSlaError(null);
      } else {
        const msg = slaResult.reason instanceof Error ? slaResult.reason.message : String(slaResult.reason);
        log.warn('useStatusPageData', 'Failed to load SLA stats', { error: msg });
        setSlaError(msg);
      }
      if (healingResult.status === 'fulfilled') {
        setHealingIssues(healingResult.value);
        setHealingError(null);
      } else {
        const msg = healingResult.reason instanceof Error ? healingResult.reason.message : String(healingResult.reason);
        log.warn('useStatusPageData', 'Failed to load healing issues', { error: msg });
        setHealingError(msg);
      }

      setLastRefreshedAt(Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('useStatusPageData', 'Failed to load status page data', { error: msg });
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [fetchExecutionDashboard]);

  // Initial load + 60s auto-refresh while the tab is visible. Without this
  // the status page is a permanent snapshot from mount time — its entire
  // purpose is freshness, so a stale "all green" view during a real outage
  // is the worst possible failure mode. Refresh pauses while the tab is
  // hidden (saves IPC) and resumes immediately on visibility return.
  useEffect(() => {
    void loadData();
    const REFRESH_INTERVAL_MS = 60_000;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => { void loadData(); }, REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    if (typeof document === 'undefined' || !document.hidden) start();

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Refresh immediately on becoming visible — the user just opened the
        // page, give them current data instead of waiting up to 60s.
        void loadData();
        start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadData]);

  const entries = useMemo((): CompositeHealthEntry[] => {
    const personas = storeBus.get<Persona[]>(AccessorKey.AGENTS_PERSONAS) ?? [];
    if (personas.length === 0) return [];

    const dailyPoints = (executionDashboard?.daily_points ?? []).map(pt => ({
      date: pt.date,
      success_rate: pt.success_rate,
      persona_costs: pt.persona_costs,
      total_executions: pt.total_executions,
      completed: pt.completed,
      failed: pt.failed,
    }));

    return computeCompositeHealth({
      personas: personas.map(p => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        color: p.color,
      })),
      slaStats,
      healingIssues,
      costAnomalyCount: executionDashboard?.cost_anomalies?.length ?? 0,
      dailyPoints,
    });
  }, [executionDashboard, slaStats, healingIssues]);

  // A score computed over a partial read is not a lower-confidence score — it is
  // a WRONG one, and wrong in the flattering direction.
  //
  // Every sub-score is `100 − problems × k`, so a source that fails to deliver
  // bad news scores as good news. Replayed against a copy of the live database
  // (78 personas, 59 SLA rows, 205 healing rows): with both sources healthy the
  // page reads 79 / DEGRADED; **with the healing fetch rejected it reads 84 /
  // HEALTHY** — a failed read raised the score five points and flipped the
  // verdict. With the SLA fetch rejected it reads 65 while every one of the 78
  // rows correctly carries `grade: 'unknown'`.
  //
  // So suppress the number when either source did not answer. `globalScore` is
  // already `number | null` and every consumer already handles null, because the
  // sibling `globalUptime` has excluded no-data entries since it was written —
  // fourteen lines away, same author. Nullability, not discipline, is what
  // propagated that fix.
  const globalScore = useMemo(
    () => (slaError || healingError ? null : computeGlobalScore(entries)),
    [entries, slaError, healingError],
  );

  const globalUptime = useMemo(() => computeGlobalUptime(entries), [entries]);

  // Combined error: the hard fetchExecutionDashboard failure takes priority,
  // then whichever per-source fetch rejected — so the existing error banner
  // fires for a partial failure instead of only a total one.
  const combinedError = error ?? slaError ?? healingError;

  return useMemo((): StatusPageState & { refresh: () => Promise<void> } => ({
    entries,
    loading,
    error: combinedError,
    slaError,
    healingError,
    lastRefreshedAt,
    globalScore,
    globalUptime,
    refresh: loadData,
  }), [entries, loading, combinedError, slaError, healingError, lastRefreshedAt, globalScore, globalUptime, loadData]);
}
