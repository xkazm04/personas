import { useState, useEffect, useMemo } from 'react';
import { listExecutions } from '@/api/agents/executions';
import { useOverviewStore } from '@/stores/overviewStore';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { HealthGrade } from '@/stores/slices/overview/personaHealthSlice';

export interface QuickStats {
  successRate: number;           // 0-100
  avgLatencyMs: number;          // milliseconds
  avgCostPerRun: number;         // USD
  lastRunAt: string | null;      // ISO timestamp
  lastRunStatus: string | null;
  totalRecent: number;           // count of recent executions
  healthGrade: HealthGrade | null;
  healthScore: number | null;    // 0-100
}

export function useQuickStats(personaId: string | undefined) {
  const [executions, setExecutions] = useState<PersonaExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const healthSignals = useOverviewStore((s) => s.healthSignals);

  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    setLoading(true);
    listExecutions(personaId, 10)
      .then((list) => { if (!cancelled) setExecutions(list); })
      .catch(() => { if (!cancelled) setExecutions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [personaId]);

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

    const withCost = executions.filter((e) => e.cost_usd > 0);
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
      lastRunAt: latest?.started_at ?? latest?.created_at ?? null,
      lastRunStatus: latest?.status ?? null,
      totalRecent: executions.length,
      healthGrade: healthSignal?.grade ?? null,
      healthScore: healthSignal?.heartbeatScore ?? null,
    };
  }, [executions, healthSignal]);

  return { stats, loading, isEmpty: executions.length === 0 };
}
