import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { useTriggerOperations } from './useTriggerOperations';
import * as api from '@/api/agents/executions';

export interface TriggerHistoryStats {
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  /** Recent failure trend: count of failures in last 5 runs */
  recentFailures: number;
}

export interface TriggerHistoryState {
  executions: PersonaExecution[];
  stats: TriggerHistoryStats;
  loading: boolean;
  error: boolean;
  /** Currently expanded execution ID for payload inspection */
  expandedId: string | null;
  replaying: string | null;
  replayResult: { id: string; success: boolean; message: string } | null;
}

export interface TriggerHistoryActions {
  fetch: () => Promise<void>;
  toggleExpanded: (id: string) => void;
  replay: (execution: PersonaExecution) => Promise<void>;
  clearReplayResult: () => void;
}

const EMPTY_STATS: TriggerHistoryStats = {
  totalRuns: 0, successCount: 0, failureCount: 0,
  successRate: 0, avgDurationMs: 0, recentFailures: 0,
};

function computeStats(execs: PersonaExecution[]): TriggerHistoryStats {
  if (execs.length === 0) return EMPTY_STATS;

  const successCount = execs.filter((e) => e.status === 'completed').length;
  const failureCount = execs.filter((e) => e.status === 'failed').length;
  const durations = execs.map((e) => e.duration_ms).filter((d): d is number => d != null && d > 0);
  const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const recent5 = execs.slice(0, 5);
  const recentFailures = recent5.filter((e) => e.status === 'failed').length;

  return {
    totalRuns: execs.length,
    successCount,
    failureCount,
    successRate: Math.round((successCount / execs.length) * 100),
    avgDurationMs,
    recentFailures,
  };
}

export function useTriggerHistory(
  triggerId: string,
  personaId: string,
): TriggerHistoryState & TriggerHistoryActions {
  const ops = useTriggerOperations(personaId);
  const [executions, setExecutions] = useState<PersonaExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<TriggerHistoryState['replayResult']>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const stats = useMemo(() => computeStats(executions), [executions]);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await ops.fetchActivity(triggerId);
      if (!mountedRef.current) return;
      if (result.ok && result.data) {
        setExecutions(result.data);
      } else {
        setError(true);
      }
    } catch {
      if (mountedRef.current) setError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [triggerId, ops]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const replay = useCallback(async (execution: PersonaExecution) => {
    setReplaying(execution.id);
    setReplayResult(null);
    try {
      const result = await api.executePersona(
        personaId,
        triggerId,
        execution.input_data ?? undefined,
        execution.use_case_id ?? undefined,
      );
      if (!mountedRef.current) return;
      setReplayResult({
        id: execution.id,
        success: true,
        message: `Replay started: execution ${result.id.slice(0, 8)}`,
      });
      // Refresh the list to include the new execution
      void fetch();
    } catch (err) {
      if (!mountedRef.current) return;
      setReplayResult({
        id: execution.id,
        success: false,
        message: err instanceof Error ? err.message : 'Replay failed',
      });
    } finally {
      if (mountedRef.current) {
        setReplaying(null);
        setTimeout(() => { if (mountedRef.current) setReplayResult(null); }, 6000);
      }
    }
  }, [personaId, triggerId, fetch]);

  const clearReplayResult = useCallback(() => setReplayResult(null), []);

  return {
    executions, stats, loading, error, expandedId, replaying, replayResult,
    fetch, toggleExpanded, replay, clearReplayResult,
  };
}
