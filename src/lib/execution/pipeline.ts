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
  { label: string; simpleLabel: string; boundary: string; description: string }
> = {
  initiate: {
    label: 'Initiate',
    simpleLabel: 'Starting up...',
    boundary: 'Frontend -> Store',
    description:
      'User triggers execution via UI. Store dispatches executePersona with persona ID, optional input data, and use-case ID.',
  },
  validate: {
    label: 'Validate',
    simpleLabel: 'Checking configuration...',
    boundary: 'Tauri Command',
    description:
      'execute_persona command validates concurrency limits, budget caps, and loads persona + tools from DB.',
  },
  create_record: {
    label: 'Create Record',
    simpleLabel: 'Preparing workspace...',
    boundary: 'Command -> DB',
    description:
      'Creates PersonaExecution row in DB with status "queued", then updates to "running". Returns execution record with ID.',
  },
  spawn_engine: {
    label: 'Spawn Engine',
    simpleLabel: 'Connecting to AI...',
    boundary: 'Engine -> Tokio Task',
    description:
      'ExecutionEngine.start_execution registers in ConcurrencyTracker, creates cancellation flag, spawns tokio task that calls runner::run_execution.',
  },
  stream_output: {
    label: 'Stream Output',
    simpleLabel: 'Processing data...',
    boundary: 'Runner -> Frontend Events',
    description:
      'Runner spawns Claude CLI process, parses stream-json stdout line by line, emits "execution-output" and protocol messages via Tauri events.',
  },
  finalize_status: {
    label: 'Finalize Status',
    simpleLabel: 'Wrapping up...',
    boundary: 'Runner -> DB + Events',
    description:
      'Runner completes, writes final status (completed/failed/cancelled) with metrics to DB, emits "execution-status" event, triggers healing/chain/notification.',
  },
  frontend_complete: {
    label: 'Frontend Complete',
    simpleLabel: 'Done!',
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
  /** Persona that ran the execution (needed by post-execution middleware). */
  personaId?: string;
  /** Duration from backend finalize_status (needed by drift/analytics middleware). */
  durationMs?: number | null;
  /** Cost from backend finalize_status (needed by drift/analytics middleware). */
  costUsd?: number | null;
  /** Error message from backend (needed by drift middleware). */
  errorMessage?: string | null;
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
// System operation types (frontend-only, not tied to executions)
// =============================================================================

/**
 * Span types for system-wide operations that occur outside the execution
 * pipeline but still benefit from structured tracing.
 */
export const SYSTEM_OPERATION_TYPES = [
  'design_conversation',
  'credential_design',
  'credential_negotiation',
  'credential_healthcheck',
  'template_generation',
  'template_adoption',
  'template_review',
  'subscription_evaluation',
  'automation_design',
  'kb_ingest',
  'recipe_execution',
  'schema_proposal',
  'query_debug',
  'nl_query',
  'setup_install',
  'context_generation',
  'task_execution',
] as const;

export type SystemOperationType = (typeof SYSTEM_OPERATION_TYPES)[number];

/** Check whether a span type is a system operation. */
export function isSystemOperation(spanType: string): spanType is SystemOperationType {
  return (SYSTEM_OPERATION_TYPES as readonly string[]).includes(spanType);
}

// =============================================================================
// Unified trace model
// =============================================================================

/**
 * Span type covering pipeline stages, backend engine span types, and
 * system-wide operation types. This unified type enables a single trace
 * viewer to render execution pipelines, engine spans, and system operations.
 */
export type UnifiedSpanType = SpanType | PipelineStage | SystemOperationType;

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

/** Options for registering a middleware. */
export interface MiddlewareOptions {
  /**
   * Unique deduplication key. If a middleware with the same key already exists
   * for the stage, it is replaced. This prevents HMR from accumulating
   * duplicate entries when a component re-mounts with a new closure.
   */
  key: string;
  /**
   * Execution priority within the stage. Lower numbers run first.
   * Middleware with equal priority run in insertion order.
   * @default 100
   */
  priority?: number;
}

interface MiddlewareEntry {
  key: string;
  priority: number;
  fn: PipelineMiddleware;
  /** Insertion counter for stable sort among equal priorities. */
  seq: number;
}

let _entrySeq = 0;

/**
 * Registry of middleware entries keyed by stage.
 * Entries are kept sorted by (priority, seq) after every mutation.
 */
const middlewareRegistry = new Map<PipelineStage, MiddlewareEntry[]>();

function sortEntries(entries: MiddlewareEntry[]): void {
  entries.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
}

/**
 * Register a middleware for a pipeline stage.
 *
 * @param stage  - Pipeline stage to attach to.
 * @param opts   - Key (deduplication) and optional priority.
 * @param fn     - The middleware function.
 */
export function addMiddleware<S extends PipelineStage>(
  stage: S,
  opts: MiddlewareOptions | string,
  fn: PipelineMiddleware<S>,
): void {
  const { key, priority = 100 } = typeof opts === 'string' ? { key: opts } : opts;
  const list = middlewareRegistry.get(stage) ?? [];

  // Remove existing entry with the same key (deduplication)
  const existingIdx = list.findIndex((e) => e.key === key);
  if (existingIdx >= 0) list.splice(existingIdx, 1);

  list.push({ key, priority, fn: fn as unknown as PipelineMiddleware, seq: ++_entrySeq });
  sortEntries(list);
  middlewareRegistry.set(stage, list);
}

/**
 * Remove a middleware by its deduplication key.
 */
export function removeMiddleware(stage: PipelineStage, key: string): void {
  const list = middlewareRegistry.get(stage);
  if (!list) return;
  const idx = list.findIndex((e) => e.key === key);
  if (idx >= 0) list.splice(idx, 1);
}

/**
 * Run all registered middleware for a stage, threading the payload through.
 * Entries execute in priority order (lower first, insertion-order tiebreak).
 */
export async function runMiddleware<S extends PipelineStage>(
  stage: S,
  payload: StagePayloadMap[S],
  trace: UnifiedTrace,
): Promise<StagePayloadMap[S]> {
  const list = middlewareRegistry.get(stage);
  if (!list || list.length === 0) return payload;

  let current = payload;
  for (const entry of list) {
    current = (await entry.fn(stage, current, trace)) as StagePayloadMap[S];
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

/**
 * Derive the current stage label and progress fraction from a trace.
 * Returns a user-friendly label (from simpleLabel) and a 0–1 fraction.
 */
export function traceProgress(trace: UnifiedTrace | null): {
  label: string;
  fraction: number;
} {
  if (!trace) return { label: 'Starting up...', fraction: 0 };

  const stages = pipelineSpans(trace);
  if (stages.length === 0) return { label: 'Starting up...', fraction: 0 };

  const lastStage = stages[stages.length - 1]!;
  const stageType = lastStage.span_type as PipelineStage;
  const idx = PIPELINE_STAGES.indexOf(stageType);
  const isComplete = trace.completedAt != null;

  const label = isComplete
    ? 'Done!'
    : STAGE_META[stageType]?.simpleLabel ?? 'Running...';

  const fraction = isComplete ? 1 : (idx + 1) / PIPELINE_STAGES.length;

  return { label, fraction };
}
