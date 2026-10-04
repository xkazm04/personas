/**
 * Tool latency and reliability over the page's window, from `get_tool_performance_summary`.
 *
 * Lifted out of `ToolPerformanceSection` on 2026-10-04 because the surface became two levels:
 * the layer-1 card shows the tool count and the worst error rate, the layer-2 section shows the
 * table, and they must not be two reads of the same command. The dashboard calls this once and
 * hands the result to both (docs/design/overview-loading.md law 6: a region retires its OWN
 * placeholder, which is about per-region settle, not about fetching the same thing twice).
 */
import { useEffect, useState } from 'react';
import { getToolPerformanceSummary } from '@/api/agents/tools';
import type { ToolPerformanceSummary } from '@/lib/bindings/ToolPerformanceSummary';
import { silentCatch } from '@/lib/silentCatch';

const LIMIT = 8;

export interface ToolPerformance {
  rows: ToolPerformanceSummary[];
  /** In flight, nothing more: ghosts render only into emptiness. */
  loading: boolean;
  failed: boolean;
}

export function useToolPerformance(since: string, personaId?: string): ToolPerformance {
  const [rows, setRows] = useState<ToolPerformanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const r = await getToolPerformanceSummary(since, personaId, LIMIT);
        if (!cancelled) setRows(r);
      } catch (err) {
        if (cancelled) return;
        silentCatch('useToolPerformance:getToolPerformanceSummary')(err);
        setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [since, personaId]);

  return { rows, loading, failed };
}

/** Worst error rate across the tools read, 0 when none ran. */
export function worstErrorRate(rows: readonly ToolPerformanceSummary[]): number {
  return rows.reduce((worst, r) => {
    const runs = Number(r.total_runs);
    return runs > 0 ? Math.max(worst, Number(r.error_runs) / runs) : worst;
  }, 0);
}
