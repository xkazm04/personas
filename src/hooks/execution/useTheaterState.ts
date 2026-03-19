/**
 * useTheaterState -- Extended replay hook for the Execution Replay Theater.
 *
 * Wraps useReplayTimeline and adds:
 * - Backend execution trace fetching & span data
 * - Current pipeline stage awareness
 * - Stage boundaries derived from trace spans
 * - Chain trace ID detection
 */

import { useState, useEffect, useMemo } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { useReplayTimeline, type ReplayState, type ReplayActions } from './useReplayTimeline';
import { getExecutionTrace } from '@/api/agents/executions';
import { getExecutionLog } from '@/api/agents/executions';
import { silentCatchNull } from "@/lib/silentCatch";
import {
  buildStageBoundaries,
  buildStageBoundariesFromSpans,
  currentStageAt,
  type StageBoundary,
} from '@/features/agents/sub_executions/components/replay/PipelineStageIndicator';
import type { PipelineStage } from '@/lib/execution/pipeline';

export interface TheaterState {
  /** Core replay state. */
  replay: ReplayState;
  /** Core replay actions. */
  actions: ReplayActions;
  /** Backend execution trace (null if not available). */
  executionTrace: ExecutionTrace | null;
  /** All trace spans from the backend. */
  traceSpans: TraceSpan[];
  /** Pipeline stage boundaries. */
  stageBoundaries: StageBoundary[];
  /** Current pipeline stage at the scrub position. */
  currentStage: PipelineStage | null;
  /** The stage where the error occurred (for failed executions). */
  errorStage: PipelineStage | null;
  /** Chain trace ID (if this execution is part of a chain). */
  chainTraceId: string | null;
  /** Log content. */
  logContent: string | null;
  /** Whether data is still loading. */
  isLoading: boolean;
}

export function useTheaterState(execution: PersonaExecution): TheaterState {
  const [executionTrace, setExecutionTrace] = useState<ExecutionTrace | null>(null);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch trace and log data
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    Promise.all([
      getExecutionTrace(execution.id, execution.persona_id).catch(silentCatchNull("theaterState:getExecutionTrace")),
      getExecutionLog(execution.id, execution.persona_id).catch(silentCatchNull("theaterState:getExecutionLog")),
    ]).then(([trace, log]) => {
      if (cancelled) return;
      setExecutionTrace(trace);
      setLogContent(log);
      setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [execution.id, execution.persona_id]);

  // Core replay state
  const [replay, actions] = useReplayTimeline(
    execution.tool_steps ?? null,
    logContent,
    execution.duration_ms ?? null,
    execution.cost_usd,
  );

  // Extract trace spans
  const traceSpans = useMemo(
    () => executionTrace?.spans ?? [],
    [executionTrace],
  );

  // Build stage boundaries from trace data or fallback to proportional
  const stageBoundaries = useMemo(() => {
    if (traceSpans.length > 0) {
      return buildStageBoundariesFromSpans(traceSpans, replay.totalMs);
    }
    return buildStageBoundaries(replay.totalMs);
  }, [traceSpans, replay.totalMs]);

  // Current pipeline stage
  const currentStage = useMemo(
    () => currentStageAt(replay.currentMs, stageBoundaries),
    [replay.currentMs, stageBoundaries],
  );

  // Error stage detection -- find the last stage that has an error span
  const errorStage = useMemo((): PipelineStage | null => {
    if (execution.status !== 'failed' && execution.status !== 'incomplete') return null;

    // Check trace spans for errors in pipeline stages
    const errorSpan = traceSpans
      .filter((s) => s.error != null)
      .sort((a, b) => b.start_ms - a.start_ms)[0];

    if (errorSpan) {
      // Map the error span's parent or type to a pipeline stage
      const healingSpan = traceSpans.find((s) => s.span_type === 'healing_analysis');
      if (healingSpan) return 'finalize_status';
      if (errorSpan.span_type === 'tool_call') return 'stream_output';
      if (errorSpan.span_type === 'credential_resolution') return 'validate';
      if (errorSpan.span_type === 'cli_spawn') return 'spawn_engine';
    }

    // Default: error in finalize stage
    return 'finalize_status';
  }, [execution.status, traceSpans]);

  // Chain trace ID
  const chainTraceId = executionTrace?.chain_trace_id ?? null;

  return {
    replay,
    actions,
    executionTrace,
    traceSpans,
    stageBoundaries,
    currentStage,
    errorStage,
    chainTraceId,
    logContent,
    isLoading,
  };
}
