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
  error: string | null;
  lastRefreshedAt: number | null;
  globalScore: number;
  globalUptime: number;
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
      }
      if (healingResult.status === 'fulfilled') {
        setHealingIssues(healingResult.value);
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

  const globalScore = useMemo(() => {
    if (entries.length === 0) return 100;
    return Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length);
  }, [entries]);

  const globalUptime = useMemo(() => {
    if (entries.length === 0) return 1;
    return entries.reduce((s, e) => s + e.uptimePercent, 0) / entries.length;
  }, [entries]);

  return useMemo((): StatusPageState & { refresh: () => Promise<void> } => ({
    entries,
    loading,
    error,
    lastRefreshedAt,
    globalScore,
    globalUptime,
    refresh: loadData,
  }), [entries, loading, error, lastRefreshedAt, globalScore, globalUptime, loadData]);
}
