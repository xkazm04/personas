import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { listExecutions } from '@/api/agents/executions';
import { useOverviewStore } from '@/stores/overviewStore';
import { silentCatch } from '@/lib/silentCatch';
import { storeBus } from '@/lib/storeBus';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { HealthGrade } from '@/stores/slices/overview/personaHealthSlice';

export interface QuickStats {
  successRate: number;           // 0-100
  avgLatencyMs: number;          // milliseconds
  avgCostPerRun: number;         // USD
  /** True when at least one recent run carried a positive duration — lets the
   *  UI show a genuine `0ms` as a value while still hiding "no timing data". */
  hasLatencyData: boolean;
  /** True when at least one recent run carried a cost — distinguishes a real
   *  `$0` run (free/local model) from "no cost data". */
  hasCostData: boolean;
  lastRunAt: string | null;      // ISO timestamp
  lastRunStatus: string | null;
  totalRecent: number;           // count of recent executions
  healthGrade: HealthGrade | null;
  healthScore: number | null;    // 0-100
}

/** Coalesce bursts of `execution:completed` events into a single refetch. */
const REFRESH_DEBOUNCE_MS = 400;

export function useQuickStats(personaId: string | undefined) {
  const [executions, setExecutions] = useState<PersonaExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const healthSignals = useOverviewStore((s) => s.healthSignals);

  // Bump to force a re-fetch without changing personaId. Driven by the
  // `execution:completed` storeBus event so stats go live when a run finishes
  // from the Use Cases tab, instead of freezing until the persona is re-selected.
  const [reloadTick, setReloadTick] = useState(0);
  const debounceRef = useRef<number | null>(null);

  const requestReload = useCallback(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      setReloadTick((n) => n + 1);
    }, REFRESH_DEBOUNCE_MS);
  }, []);

  // Subscribe once per personaId. The middleware emits `personaId: ''` for
  // executions it couldn't attribute — treat the empty case as "refresh
  // anyway" so an unattributed completion still refreshes the open editor.
  useEffect(() => {
    if (!personaId) return;
    const off = storeBus.on('execution:completed', ({ personaId: pid }) => {
      if (!pid || pid === personaId) requestReload();
    });
    return () => {
      off();
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [personaId, requestReload]);

  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    // Only show the skeleton on the first load; live refreshes update in place
    // so the row doesn't flash a spinner every time a run completes.
    if (reloadTick === 0) setLoading(true);
    // Fetch 50 to match ActivityTab's request shape — identical args let
    // tauriInvoke's 250ms read-only auto-dedup catch concurrent mounts in
    // the persona editor. Slice locally so quick-stats math still runs over
    // the most-recent 10 rows (unchanged semantics).
    listExecutions(personaId, 50)
      .then((list) => { if (!cancelled) setExecutions(list.slice(0, 10)); })
      .catch((err) => {
        silentCatch('useQuickStats:listExecutions')(err);
        if (!cancelled) setExecutions([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [personaId, reloadTick]);

  const healthSignal = useMemo(
    () => healthSignals.find((s) => s.personaId === personaId) ?? null,
    [healthSignals, personaId],
  );

  const stats = useMemo((): QuickStats | null => {
    if (executions.length === 0) return null;

    const completed = executions.filter((e) => e.status === 'completed' || e.status === 'success');
    const successRate = (completed.length / executions.length) * 100;

    const withDuration = executions.filter((e) => e.duration_ms != null && e.duration_ms > 0);
    const avgLatencyMs = withDuration.length > 0
      ? withDuration.reduce((sum, e) => sum + (e.duration_ms ?? 0), 0) / withDuration.length
      : 0;

    const withCost = executions.filter((e) => e.cost_usd != null && e.cost_usd > 0);
    const avgCostPerRun = withCost.length > 0
      ? withCost.reduce((sum, e) => sum + e.cost_usd, 0) / withCost.length
      : 0;

    const sorted = [...executions].sort((a, b) => {
      const ta = a.started_at ?? a.created_at;
      const tb = b.started_at ?? b.created_at;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });
    const latest = sorted[0];

    return {
      successRate: Math.round(successRate),
      avgLatencyMs: Math.round(avgLatencyMs),
      avgCostPerRun,
      hasLatencyData: withDuration.length > 0,
      hasCostData: withCost.length > 0,
      lastRunAt: latest?.started_at ?? latest?.created_at ?? null,
      lastRunStatus: latest?.status ?? null,
      totalRecent: executions.length,
      healthGrade: healthSignal?.grade ?? null,
      healthScore: healthSignal?.heartbeatScore ?? null,
    };
  }, [executions, healthSignal]);

  return { stats, loading, isEmpty: executions.length === 0 };
}
