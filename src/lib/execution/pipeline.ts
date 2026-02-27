/**
 * ExecutionPipeline — First-class definition of the execution data flow.
 *
 * The execution flow traverses 7 boundaries:
 *   Frontend Initiate -> Tauri Command -> Engine Spawn -> CLI Process
 *     -> Stream Events -> Status Finalize -> Frontend Complete
 *
 * Each stage is a typed transform from one payload shape to the next.
 * This module serves as both documentation and runtime schema for
 * pipeline-level concerns (tracing, middleware, error propagation).
 */

import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

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
      'usePersonaExecution receives terminal status event, appends [SUMMARY] line, calls finishExecution to clear isExecuting and refresh history.',
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
// Pipeline tracing
// =============================================================================

/** A single trace entry for pipeline observability. */
export interface PipelineTraceEntry {
  stage: PipelineStage;
  timestamp: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Accumulated trace for one execution's pipeline journey. */
export interface PipelineTrace {
  executionId: string;
  entries: PipelineTraceEntry[];
  startedAt: number;
  completedAt?: number;
}

/**
 * Create a new pipeline trace for an execution.
 */
export function createPipelineTrace(executionId: string): PipelineTrace {
  return {
    executionId,
    entries: [],
    startedAt: Date.now(),
  };
}

/**
 * Record a stage entry in the trace.
 */
export function traceStage(
  trace: PipelineTrace,
  stage: PipelineStage,
  metadata?: Record<string, unknown>,
  error?: string,
): PipelineTrace {
  const now = Date.now();
  const prevEntry = trace.entries[trace.entries.length - 1];
  if (prevEntry && prevEntry.durationMs === undefined) {
    prevEntry.durationMs = now - prevEntry.timestamp;
  }

  return {
    ...trace,
    entries: [
      ...trace.entries,
      { stage, timestamp: now, metadata, error },
    ],
  };
}

/**
 * Mark the trace as complete.
 */
export function completeTrace(trace: PipelineTrace): PipelineTrace {
  const now = Date.now();
  const entries = [...trace.entries];
  const last = entries[entries.length - 1];
  if (last && last.durationMs === undefined) {
    last.durationMs = now - last.timestamp;
  }
  return { ...trace, entries, completedAt: now };
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
  trace: PipelineTrace,
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
  trace: PipelineTrace,
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
  trace: PipelineTrace,
  stage: PipelineStage,
): boolean {
  return trace.entries.some((e) => e.stage === stage);
}

/** Total pipeline duration from trace (if complete). */
export function traceDuration(trace: PipelineTrace): number | null {
  if (!trace.completedAt) return null;
  return trace.completedAt - trace.startedAt;
}
