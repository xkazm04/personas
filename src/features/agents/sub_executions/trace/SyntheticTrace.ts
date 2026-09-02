import type { PersonaExecution } from '@/lib/types/types';
import type { PipelineTrace, PipelineStage, UnifiedSpan } from '@/lib/execution/pipeline';
import { normalizePipelineStageSpans, isBackendPipelineStage, pipelineStageOf } from '@/lib/execution/pipeline';

// ---------------------------------------------------------------------------
// Synthetic trace builder (for historical executions without live trace)
// ---------------------------------------------------------------------------

/**
 * A `PipelineTrace` reconstructed from an execution's start/end timestamps
 * (via `buildSyntheticTrace`) rather than captured live, per-stage, during
 * the run. Every span duration below is a proportional ESTIMATE (fixed %
 * splits of the total wall-clock time) — not a measurement. `isSynthetic`
 * lets a renderer distinguish this from a real captured trace (the existing
 * `isLive` signal PipelineWaterfall derives separately) so it can show an
 * "Estimated" badge instead of presenting ms-precision guesses as fact.
 */
export interface SyntheticPipelineTrace extends PipelineTrace {
  isSynthetic: true;
}

export function buildSyntheticTrace(execution: PersonaExecution): SyntheticPipelineTrace | null {
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
    isSynthetic: true,
  };
}

// ---------------------------------------------------------------------------
// Hybrid trace builder (stored backend stages + estimated frontend stages)
// ---------------------------------------------------------------------------

/** The three pipeline stages the frontend emits and no trace ever persists. */
const FRONTEND_ONLY_STAGES = ['initiate', 'create_record', 'frontend_complete'] as const;

/**
 * A pipeline trace whose bars are NOT all the same kind of thing.
 *
 * The four backend stages are read from the persisted trace -- real, closed,
 * measured spans. The three frontend stages have no recorded counterpart in
 * any trace, so they stay estimates. `estimatedStages` names exactly which
 * bars are which, so the renderer can mark the estimates individually instead
 * of stamping one badge across a chart that is mostly measurement.
 */
export interface HybridPipelineTrace extends PipelineTrace {
  isSynthetic: false;
  estimatedStages: ReadonlySet<PipelineStage>;
}

/**
 * Build a pipeline waterfall from a persisted trace's stage spans.
 *
 * Returns null when the trace carries no backend pipeline stage at all, so the
 * caller falls back to the fully-reconstructed `buildSyntheticTrace`.
 *
 * Geometry: the measured stages keep their recorded offsets and durations
 * EXACTLY, shifted as one block by the estimated frontend prologue. The
 * estimates are sized from what the backend did NOT account for -- the run's
 * wall clock minus the measured span -- rather than from a fixed percentage,
 * so they shrink toward nothing on a run whose duration was measured end to
 * end, instead of the synthetic model's flat 1/1/1%.
 */
export function buildHybridTrace(
  execution: PersonaExecution,
  storedSpans: UnifiedSpan[],
): HybridPipelineTrace | null {
  const normalized = normalizePipelineStageSpans(storedSpans);
  const measured = normalized.filter((s) => {
    const stage = pipelineStageOf(s);
    return stage !== null && isBackendPipelineStage(stage);
  });
  if (measured.length === 0) return null;

  const startSource = execution.started_at ?? execution.created_at;
  const startTime = startSource ? new Date(startSource).getTime() : NaN;
  if (Number.isNaN(startTime)) return null;

  const ends = measured.map((s) => s.end_ms ?? s.start_ms + (s.duration_ms ?? 0));
  const measuredStart = Math.min(...measured.map((s) => s.start_ms));
  const measuredEnd = Math.max(...ends);
  const measuredSpanMs = Math.max(measuredEnd - measuredStart, 0);

  const wallClockMs = execution.completed_at
    ? new Date(execution.completed_at).getTime() - startTime
    : (execution.duration_ms ?? 0);

  // Whatever the run took that the backend did NOT account for is the frontend
  // overhead, split across the three frontend stages. A 5ms floor each keeps
  // them visible -- and honest about being nominal -- when there is no slack.
  const slack = Math.max(wallClockMs - measuredSpanMs, 0);
  const estDur = Math.max(Math.round(slack / FRONTEND_ONLY_STAGES.length), 5);
  const prologueMs = estDur * 2; // initiate + create_record

  const estimate = (
    stage: PipelineStage,
    startMs: number,
    metadata?: Record<string, unknown>,
  ): UnifiedSpan => ({
    span_id: `est-${stage}`,
    parent_span_id: null,
    span_type: stage,
    name: stage,
    start_ms: startMs,
    end_ms: startMs + estDur,
    duration_ms: estDur,
    cost_usd: null,
    error: null,
    metadata: metadata ?? null,
  });

  const spans: UnifiedSpan[] = [
    estimate('initiate', 0, { personaId: execution.persona_id }),
    estimate('create_record', estDur, { executionId: execution.id }),
  ];

  for (const s of measured) {
    const stage = pipelineStageOf(s) as PipelineStage;
    const end = s.end_ms ?? s.start_ms + (s.duration_ms ?? 0);
    spans.push({
      ...s,
      span_type: stage,
      name: stage,
      start_ms: s.start_ms - measuredStart + prologueMs,
      end_ms: end - measuredStart + prologueMs,
      duration_ms: s.duration_ms ?? end - s.start_ms,
    });
  }

  const afterMeasured = prologueMs + measuredSpanMs;
  spans.push(estimate('frontend_complete', afterMeasured, { status: execution.status }));

  return {
    executionId: execution.id,
    spans,
    startedAt: startTime,
    completedAt: startTime + afterMeasured + estDur,
    isSynthetic: false,
    estimatedStages: new Set<PipelineStage>(FRONTEND_ONLY_STAGES),
  };
}
