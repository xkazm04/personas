import type { DbPersonaExecution } from '@/lib/types/types';
import type { PipelineTrace, PipelineStage, UnifiedSpan } from '@/lib/execution/pipeline';

// ---------------------------------------------------------------------------
// Synthetic trace builder (for historical executions without live trace)
// ---------------------------------------------------------------------------

export function buildSyntheticTrace(execution: DbPersonaExecution): PipelineTrace | null {
  if (!execution.started_at && !execution.created_at) return null;

  const startTime = new Date(execution.started_at ?? execution.created_at).getTime();
  const endTime = execution.completed_at
    ? new Date(execution.completed_at).getTime()
    : execution.duration_ms
      ? startTime + execution.duration_ms
      : null;

  if (!endTime) return null;

  const totalDuration = endTime - startTime;
  if (totalDuration <= 0) return null;

  // Estimate stage durations based on typical proportions
  const spans: UnifiedSpan[] = [];
  let cursorMs = 0; // relative to startTime
  let spanIdx = 0;

  const makeSpan = (
    stage: PipelineStage,
    durationMs: number,
    extra?: { metadata?: Record<string, unknown>; error?: string },
  ): UnifiedSpan => ({
    span_id: `synth-${spanIdx++}`,
    parent_span_id: null,
    span_type: stage,
    name: stage,
    start_ms: cursorMs,
    end_ms: cursorMs + durationMs,
    duration_ms: durationMs,
    cost_usd: null,
    error: extra?.error ?? null,
    metadata: extra?.metadata ?? null,
  });

  // initiate: ~1% (quick frontend dispatch)
  const initDur = Math.max(totalDuration * 0.01, 5);
  spans.push(makeSpan('initiate', initDur, { metadata: { personaId: execution.persona_id } }));
  cursorMs += initDur;

  // validate: ~2%
  const validateDur = Math.max(totalDuration * 0.02, 10);
  spans.push(makeSpan('validate', validateDur));
  cursorMs += validateDur;

  // create_record: ~1%
  const createDur = Math.max(totalDuration * 0.01, 5);
  spans.push(makeSpan('create_record', createDur, { metadata: { executionId: execution.id } }));
  cursorMs += createDur;

  // spawn_engine: ~1%
  const spawnDur = Math.max(totalDuration * 0.01, 10);
  spans.push(makeSpan('spawn_engine', spawnDur));
  cursorMs += spawnDur;

  // stream_output: ~90% (the bulk)
  const streamDur = endTime - startTime - cursorMs - Math.max(totalDuration * 0.03, 20);
  const actualStreamDur = Math.max(streamDur, 50);
  spans.push(makeSpan('stream_output', actualStreamDur));
  cursorMs += actualStreamDur;

  // finalize_status: ~2%
  const finalizeDur = Math.max(totalDuration * 0.02, 10);
  spans.push(makeSpan('finalize_status', finalizeDur, { error: execution.error_message ?? undefined }));
  cursorMs += finalizeDur;

  // frontend_complete: ~1%
  const feCompleteDur = Math.max(totalDuration - cursorMs, 5);
  spans.push(makeSpan('frontend_complete', feCompleteDur, { metadata: { status: execution.status } }));

  return {
    executionId: execution.id,
    spans,
    startedAt: startTime,
    completedAt: endTime,
  };
}
