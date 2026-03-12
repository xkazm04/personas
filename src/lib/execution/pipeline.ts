/**
 * ExecutionPipeline -- First-class definition of the execution data flow.
 *
 * The execution flow traverses 7 boundaries:
 *   Frontend Initiate -> Tauri Command -> Engine Spawn -> CLI Process
 *     -> Stream Events -> Status Finalize -> Frontend Complete
 *
 * Each stage is a typed transform from one payload shape to the next.
 * This module serves as both documentation and runtime schema for
 * pipeline-level concerns (tracing, middleware, error propagation).
 *
 * ## Unified Trace Model
 *
 * Pipeline stages and backend engine spans share a single span-based
 * representation (`UnifiedSpan`). The 7 pipeline stages become root
 * spans in the same tree, and backend `TraceSpan` objects (tool calls,
 * prompt assembly, etc.) nest under the appropriate stage span.
 * Both PipelineWaterfall and TraceInspector consume the same
 * `UnifiedTrace` data.
 */

import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { SpanType } from '@/lib/bindings/SpanType';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';

// =============================================================================
// Stage definitions
// =============================================================================

/**
 * The ordered stages of an execution pipeline.
 * Each stage represents a boundary crossing in the system.
 */
export const PIPELINE_STAGES = [
  'initiate',
  'validate',
  'create_record',
  'spawn_engine',
  'stream_output',
  'finalize_status',
  'frontend_complete',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Human-readable descriptions for each stage (documentation-as-code). */
export const STAGE_META: Record<
  PipelineStage,
  { label: string; boundary: string; description: string }
> = {
  initiate: {
    label: 'Initiate',
    boundary: 'Frontend -> Store',
    description:
      'User triggers execution via UI. Store dispatches executePersona with persona ID, optional input data, and use-case ID.',
  },
  validate: {
    label: 'Validate',
    boundary: 'Tauri Command',
    description:
      'execute_persona command validates concurrency limits, budget caps, and loads persona + tools from DB.',
  },
  create_record: {
    label: 'Create Record',
    boundary: 'Command -> DB',
    description:
      'Creates PersonaExecution row in DB with status "queued", then updates to "running". Returns execution record with ID.',
  },
  spawn_engine: {
    label: 'Spawn Engine',
    boundary: 'Engine -> Tokio Task',
    description:
      'ExecutionEngine.start_execution registers in ConcurrencyTracker, creates cancellation flag, spawns tokio task that calls runner::run_execution.',
  },
  stream_output: {
    label: 'Stream Output',
    boundary: 'Runner -> Frontend Events',
    description:
      'Runner spawns Claude CLI process, parses stream-json stdout line by line, emits "execution-output" and protocol messages via Tauri events.',
  },
  finalize_status: {
    label: 'Finalize Status',
    boundary: 'Runner -> DB + Events',
    description:
      'Runner completes, writes final status (completed/failed/cancelled) with metrics to DB, emits "execution-status" event, triggers healing/chain/notification.',
  },
  frontend_complete: {
    label: 'Frontend Complete',
    boundary: 'Events -> Store',
    description:
      'usePersonaExecution receives terminal status event, passes typed statusData to finishExecution to clear isExecuting and refresh history.',
  },
};

// =============================================================================
// Typed payloads at each stage boundary
// =============================================================================

/** Payload entering the pipeline from the UI. */
export interface InitiatePayload {
  personaId: string;
  inputData?: object;
  useCaseId?: string;
}

/** Payload after Tauri command validation (before DB insert). */
export interface ValidatePayload {
  personaId: string;
  personaName: string;
  triggerId: string | null;
  inputData: string | null;
  useCaseId: string | null;
  modelUsed: string | null;
}

/** Payload after DB record creation. */
export interface CreateRecordPayload {
  executionId: string;
  execution: PersonaExecution;
}

/** Payload after engine task spawn. */
export interface SpawnEnginePayload {
  executionId: string;
  taskSpawned: true;
}

/** Payload for each streamed output line. */
export interface StreamOutputPayload {
  executionId: string;
  line: string;
}

/** Payload when execution reaches a terminal status. */
export interface FinalizeStatusPayload {
  executionId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'incomplete';
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
}

/** Payload after the frontend has processed the terminal event. */
export interface FrontendCompletePayload {
  executionId: string;
  finalStatus: string;
}

/**
 * Map from stage name to its output payload type.
 * Enables type-safe middleware that transforms or observes payloads.
 */
export interface StagePayloadMap {
  initiate: InitiatePayload;
  validate: ValidatePayload;
  create_record: CreateRecordPayload;
  spawn_engine: SpawnEnginePayload;
  stream_output: StreamOutputPayload;
  finalize_status: FinalizeStatusPayload;
  frontend_complete: FrontendCompletePayload;
}

// =============================================================================
// Unified trace model
// =============================================================================

/**
 * Span type covering both pipeline stages and backend engine span types.
 * Pipeline stages are frontend-only; SpanType values come from the Rust backend.
 */
export type UnifiedSpanType = SpanType | PipelineStage;

/** Check whether a span type is a pipeline stage. */
export function isPipelineStage(spanType: UnifiedSpanType): spanType is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(spanType);
}

let _spanCounter = 0;

/**
 * A single span in the unified trace tree.
 *
 * Replaces the old `PipelineTraceEntry` (flat stage records) and unifies
 * with the backend's `TraceSpan` (hierarchical engine spans). Pipeline
 * stages and engine spans now share the same shape, enabling both
 * PipelineWaterfall and TraceInspector to render from one data source.
 */
export interface UnifiedSpan {
  span_id: string;
  parent_span_id: string | null;
  span_type: UnifiedSpanType;
  name: string;
  /** Milliseconds relative to trace startedAt. */
  start_ms: number;
  end_ms: number | null;
  duration_ms: number | null;
  cost_usd: number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Unified trace for one execution, holding both pipeline stage spans
 * and (optionally) backend engine spans in a single span list.
 *
 * Replaces the old `PipelineTrace` (flat entry list) and can absorb
 * backend `ExecutionTrace` spans via `mergeBackendSpans()`.
 */
export interface UnifiedTrace {
  executionId: string;
  spans: UnifiedSpan[];
  /** Absolute timestamp (ms since epoch) when the trace started. */
  startedAt: number;
  /** Absolute timestamp (ms since epoch) when the trace completed. */
  completedAt?: number;
}

/**
 * @deprecated Use `UnifiedSpan` instead. Kept as alias for migration.
 */
export type PipelineTraceEntry = UnifiedSpan;

/**
 * @deprecated Use `UnifiedTrace` instead. Kept as alias for migration.
 */
export type PipelineTrace = UnifiedTrace;

// =============================================================================
// Trace lifecycle
// =============================================================================

/**
 * Create a new unified trace for an execution.
 */
export function createPipelineTrace(executionId: string): UnifiedTrace {
  return {
    executionId,
    spans: [],
    startedAt: Date.now(),
  };
}

/**
 * Record a pipeline stage span in the trace.
 * Automatically finalizes the previous stage's end_ms/duration_ms.
 */
export function traceStage(
  trace: UnifiedTrace,
  stage: PipelineStage,
  metadata?: Record<string, unknown>,
  error?: string,
): UnifiedTrace {
  const now = Date.now();
  const relativeMs = now - trace.startedAt;

  // Finalize previous pipeline stage span
  const spans = trace.spans.map((s) => {
    if (isPipelineStage(s.span_type) && s.end_ms === null) {
      return { ...s, end_ms: relativeMs, duration_ms: relativeMs - s.start_ms };
    }
    return s;
  });

  const span: UnifiedSpan = {
    span_id: `pipeline-${stage}-${++_spanCounter}`,
    parent_span_id: null,
    span_type: stage,
    name: STAGE_META[stage].label,
    start_ms: relativeMs,
    end_ms: null,
    duration_ms: null,
    cost_usd: null,
    error: error ?? null,
    metadata: metadata ?? null,
  };

  return {
    ...trace,
    spans: [...spans, span],
  };
}

/**
 * Mark the trace as complete. Finalizes any open spans.
 */
export function completeTrace(trace: UnifiedTrace): UnifiedTrace {
  const now = Date.now();
  const relativeMs = now - trace.startedAt;

  const spans = trace.spans.map((s) => {
    if (s.end_ms === null) {
      return { ...s, end_ms: relativeMs, duration_ms: relativeMs - s.start_ms };
    }
    return s;
  });

  return { ...trace, spans, completedAt: now };
}

// =============================================================================
// Backend span merging
// =============================================================================

/**
 * Merge backend TraceSpan objects into an existing UnifiedTrace.
 *
 * Backend spans are converted to UnifiedSpan and parented under the
 * `stream_output` pipeline stage (since that's when engine work occurs).
 * If no stream_output stage exists yet, spans are added as roots.
 */
export function mergeBackendSpans(
  trace: UnifiedTrace,
  backendSpans: TraceSpan[],
): UnifiedTrace {
  // Find the stream_output pipeline stage span to parent backend spans under
  const streamSpan = trace.spans.find((s) => s.span_type === 'stream_output');
  const parentId = streamSpan?.span_id ?? null;

  const converted: UnifiedSpan[] = backendSpans.map((s) => ({
    span_id: s.span_id,
    // Root backend spans become children of stream_output; nested spans keep their parent
    parent_span_id: s.parent_span_id ?? parentId,
    span_type: s.span_type as UnifiedSpanType,
    name: s.name,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    duration_ms: s.duration_ms,
    cost_usd: s.cost_usd,
    error: s.error,
    metadata: s.metadata as Record<string, unknown> | null,
  }));

  // Deduplicate by span_id -- backend may re-send spans we already have
  const existingIds = new Set(trace.spans.map((s) => s.span_id));
  const newSpans = converted.filter((s) => !existingIds.has(s.span_id));

  return {
    ...trace,
    spans: [...trace.spans, ...newSpans],
  };
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * A pipeline middleware can observe or transform a stage payload.
 * Returning the payload continues the pipeline; throwing aborts it.
 */
export type PipelineMiddleware<S extends PipelineStage = PipelineStage> = (
  stage: S,
  payload: StagePayloadMap[S],
  trace: UnifiedTrace,
) => StagePayloadMap[S] | Promise<StagePayloadMap[S]>;

/**
 * Registry of middleware functions keyed by stage.
 * Use addMiddleware/removeMiddleware to manage the registry.
 */
const middlewareRegistry = new Map<PipelineStage, PipelineMiddleware[]>();

export function addMiddleware<S extends PipelineStage>(
  stage: S,
  fn: PipelineMiddleware<S>,
): void {
  const list = middlewareRegistry.get(stage) ?? [];
  list.push(fn as unknown as PipelineMiddleware);
  middlewareRegistry.set(stage, list);
}

export function removeMiddleware<S extends PipelineStage>(
  stage: S,
  fn: PipelineMiddleware<S>,
): void {
  const list = middlewareRegistry.get(stage);
  if (!list) return;
  const idx = list.indexOf(fn as unknown as PipelineMiddleware);
  if (idx >= 0) list.splice(idx, 1);
}

/**
 * Run all registered middleware for a stage, threading the payload through.
 */
export async function runMiddleware<S extends PipelineStage>(
  stage: S,
  payload: StagePayloadMap[S],
  trace: UnifiedTrace,
): Promise<StagePayloadMap[S]> {
  const list = middlewareRegistry.get(stage);
  if (!list || list.length === 0) return payload;

  let current = payload;
  for (const fn of list) {
    current = (await fn(stage, current, trace)) as StagePayloadMap[S];
  }
  return current;
}

// =============================================================================
// Utilities
// =============================================================================

/** Get the next stage in the pipeline (or null if at the end). */
export function nextStage(current: PipelineStage): PipelineStage | null {
  const idx = PIPELINE_STAGES.indexOf(current);
  if (idx >= 0 && idx < PIPELINE_STAGES.length - 1) {
    return PIPELINE_STAGES[idx + 1] as PipelineStage;
  }
  return null;
}

/** Get stage index (0-based). */
export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

/** Check if an execution has passed a given stage based on its trace. */
export function hasPassedStage(
  trace: UnifiedTrace,
  stage: PipelineStage,
): boolean {
  return trace.spans.some((s) => s.span_type === stage);
}

/** Total pipeline duration from trace (if complete). */
export function traceDuration(trace: UnifiedTrace): number | null {
  if (!trace.completedAt) return null;
  return trace.completedAt - trace.startedAt;
}

/** Extract only pipeline stage spans from a unified trace (ordered). */
export function pipelineSpans(trace: UnifiedTrace): UnifiedSpan[] {
  const stageOrder = new Map(PIPELINE_STAGES.map((s, i) => [s as string, i]));
  return trace.spans
    .filter((s) => isPipelineStage(s.span_type))
    .sort((a, b) => (stageOrder.get(a.span_type) ?? 0) - (stageOrder.get(b.span_type) ?? 0));
}

/** Extract backend engine spans (non-pipeline) from a unified trace. */
export function engineSpans(trace: UnifiedTrace): UnifiedSpan[] {
  return trace.spans.filter((s) => !isPipelineStage(s.span_type));
}
