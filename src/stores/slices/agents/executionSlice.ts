import type { StateCreator } from "zustand";
import type { AgentStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import { createLogger } from "@/lib/log";

const logger = createLogger("execution");
import type { ExecutionListItem } from "@/lib/bindings/ExecutionListItem";
import type { PipelineTrace } from "@/lib/execution/pipeline";
import {
  createPipelineTrace,
  traceStage,
  completeTrace,
  runMiddleware,
} from "@/lib/execution/pipeline";
import type {
  InitiatePayload,
  CreateRecordPayload,
  SpawnEnginePayload,
  FrontendCompletePayload,
} from "@/lib/execution/pipeline";
import type { Continuation } from "@/lib/bindings/Continuation";
import type { DesignDriftEvent } from "@/lib/design/designDrift";
import { loadDriftEvents, saveDriftEvents } from "@/lib/design/designDrift";
import { cancelExecution, executePersona, getExecution, listExecutionsSummary } from "@/api/agents/executions";
import { InvokeTimeoutError } from "@/lib/tauriInvoke";

import { executionSink } from "@/lib/execution/executionSink";
import { TERMINAL_STATUS_SET } from "@/lib/execution/executionState";
import { classifyLine } from "@/lib/utils/terminalColors";
import { createRunLifecycle } from "./runLifecycle";
import { trackRecentAgent } from "@/hooks/agents/useRecentAgents";
import { en } from "@/i18n/en";
import { silentCatch } from '@/lib/silentCatch';


const executionLifecycle = createRunLifecycle('isExecuting', 'executionProgress');

/** Maximum number of completed execution output snapshots to retain in memory. */
const MAX_COMPLETED_SNAPSHOTS = 5;
/**
 * Completed execution output TTL (ms). Snapshots older than this are dropped
 * on the next finish sweep — guards against long multi-hour sessions where
 * a handful of unconsumed snapshots would otherwise pin tens of MB.
 */
const COMPLETED_OUTPUT_TTL_MS = 30 * 60 * 1000;
const EXECUTIONS_CACHE_TTL_MS = 30_000;
/** Max personas kept in the per-persona executions cache (LRU-evicted). */
const EXECUTIONS_CACHE_MAX_PERSONAS = 12;

/**
 * How long a minted foreground idempotency key may be REUSED on a retry of the
 * same logical request. The idempotency key must stay stable across a
 * timeout+retry so the backend's `create_with_idempotency` returns the
 * already-spawned execution instead of double-spawning. But it must NOT stay
 * stable forever, or a user deliberately re-running the same input minutes
 * later would silently receive the previous (orphaned) run's result. The slot
 * is normally cleared the moment the foreground run reaches a terminal state
 * (finishExecution / cancelExecution); this window is only a backstop for the
 * case where the first run was orphaned by the timeout and the user never
 * retried — after it elapses, an identical request mints a fresh key.
 */
const IDEMPOTENCY_REUSE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Stable signature for a logical execution request. Used only in-memory to
 * decide whether a new foreground call is a RETRY of the pending request (→
 * reuse its idempotency key) or a DIFFERENT request (→ mint a fresh key). It is
 * never transmitted. Derived from the ORIGINAL caller inputs (not the
 * middleware-enriched inputData, which can be non-deterministic) so a retry of
 * the same user action produces the same signature.
 */
function executionRequestSignature(
  personaId: string,
  useCaseId: string | undefined,
  inputData: object | undefined,
  continuation: Continuation | undefined,
): string {
  try {
    return JSON.stringify([personaId, useCaseId ?? null, inputData ?? null, continuation ?? null]);
  } catch {
    // Unstringifiable input (e.g. a cycle) — return a unique signature so we
    // never accidentally collapse two unrelated requests onto one key. This
    // forfeits retry-dedup for this edge case but can never wrong-dedup.
    return `nonstable:${crypto.randomUUID()}`;
  }
}

/** Finish-time map keyed by executionId. Module-local (not persisted). */
const completedOutputFinishedAt = new Map<string, number>();

/**
 * Per-execution output snapshots, keyed by executionId. Module-local Map
 * (not in store state) so finishExecution doesn't churn the store tree on
 * every completion. DAG walkers retrieve via consumeCompletedOutput().
 *
 * Insertion order is preserved by Map, used for FIFO eviction past
 * MAX_COMPLETED_SNAPSHOTS.
 */
const completedOutputs = new Map<string, string[]>();

/** Queue status event emitted from the engine when an execution is queued/promoted. */
export interface QueueStatusPayload {
  execution_id: string;
  persona_id: string;
  action: "queued" | "promoted" | "queue_full";
  position: number | null;
  queue_depth: number;
}

/** Structured progress for the execution lifecycle -- analogous to TestRunProgress / LabRunProgress. */
export interface ExecutionRunProgress {
  executionId?: string;
  phase: string;
  pipelineStage?: string;
  status?: string;
  error?: string;
}

/** A background execution tracked minimally (no terminal output buffering). */
export interface BackgroundExecution {
  executionId: string;
  personaId: string;
  personaName: string;
  personaColor: string;
  status: 'running' | 'queued' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
}

export interface ExecutionSlice {
  // State
  executions: ExecutionListItem[];
  /** Whether the execution list is currently being fetched. */
  executionsLoading: boolean;
  /** True when the last executions fetch failed — lets the list show an error +
   *  retry instead of the "no runs yet" empty state. */
  executionsError: boolean;
  /** The personaId whose executions are currently loaded (for cache coherence). */
  executionsPersonaId: string | null;
  executionsCache: Record<string, ExecutionListItem[]>;
  executionsCacheAt: Record<string, number>;
  activeExecutionId: string | null;
  executionPersonaId: string | null;
  activeUseCaseId: string | null;
  executionOutput: string[];
  /** Total bytes accumulated in executionOutput (for budget enforcement). */
  executionOutputBytes: number;
  isExecuting: boolean;
  /** Structured progress tracking (managed by RunLifecycle). */
  executionProgress: ExecutionRunProgress | null;
  /** Pipeline trace for the active execution (observability). */
  pipelineTrace: PipelineTrace | null;
  /** Queue position for the active execution (null = not queued / running). */
  queuePosition: number | null;
  /** Total queue depth when queued. */
  queueDepth: number | null;
  /** Design drift events detected from execution outcomes. */
  designDriftEvents: DesignDriftEvent[];
  /** Last completed/cancelled execution ID -- survives state reset so Resume can fetch its session. */
  lastExecutionId: string | null;
  /** Background executions running concurrently (no terminal output — tracked for status only). */
  backgroundExecutions: BackgroundExecution[];
  /** True when startup recovery could not reach the backend to verify a recovered execution. */
  executionVerificationFailed: boolean;

  // Actions
  executePersona: (personaId: string, inputData?: object, useCaseId?: string, continuation?: Continuation) => Promise<string | null>;
  cancelExecution: (executionId: string) => Promise<void>;
  finishExecution: (status?: string, statusData?: { durationMs?: number | null; costUsd?: number | null; errorMessage?: string | null }) => void;
  fetchExecutions: (personaId: string) => Promise<void>;
  appendExecutionOutput: (line: string) => void;
  clearExecutionOutput: () => void;
  setQueueStatus: (position: number | null, depth: number | null) => void;
  setExecutionProgress: (progress: ExecutionRunProgress | null) => void;
  dismissDriftEvent: (eventId: string) => void;
  /** Update a background execution's status (called from event listeners). */
  updateBackgroundExecution: (executionId: string, status: BackgroundExecution['status']) => void;
  /** Remove a background execution from tracking. */
  removeBackgroundExecution: (executionId: string) => void;
  /** Retrieve and remove a completed execution's output snapshot (one-shot read). */
  consumeCompletedOutput: (executionId: string) => string[] | undefined;
  /** Retry verifying a recovered execution after a previous network failure. */
  retryExecutionVerification: () => Promise<void>;
  /** Dismiss the verification failure and abandon the recovered execution. */
  dismissVerificationFailure: () => void;
}

export const createExecutionSlice: StateCreator<AgentStore, [], [], ExecutionSlice> = (set, get) => {
  // Bind the sink to push flushed output into the store.
  // On HMR / store recreation, re-binding automatically invalidates stale flushes.
  executionSink.reset();
  executionSink.bind((output, totalBytes) => {
    set({ executionOutput: output, executionOutputBytes: totalBytes });
  });

  // Dev-only size probe — surfaces ring/tail occupancy, byte total, spilled
  // flag, and completed-snapshot count so regressions in long sessions are
  // visible from the DevTools console without any UI.
  if (import.meta.env.DEV) {
    (globalThis as unknown as { __executionBufferProbe__?: () => unknown }).__executionBufferProbe__ = () => {
      const sink = executionSink.probe();
      return {
        ...sink,
        completedSnapshots: completedOutputs.size,
        completedMaxSnapshots: MAX_COMPLETED_SNAPSHOTS,
        completedTtlMs: COMPLETED_OUTPUT_TTL_MS,
      };
    };
  }

  // Recovery: restore active execution state from localStorage
  const recoveredState = (() => {
    try {
      const stored = localStorage.getItem('personas:active-execution');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.activeExecutionId && parsed.isExecuting) {
          return {
            activeExecutionId: parsed.activeExecutionId as string,
            executionPersonaId: parsed.executionPersonaId as string | null,
            isExecuting: true,
          };
        }
      }
    } catch (err) { silentCatch("stores/slices/agents/executionSlice:catch1")(err); }
    return null;
  })();

  // Reconcile recovered execution against the backend. If the execution already
  // reached a terminal state (completed/cancelled/failed) while the app was closed,
  // clear the stale isExecuting flag so the UI doesn't show a phantom active run.

  if (recoveredState) {
    // Seed the run-lifecycle FSM into 'running' so it matches the recovered
    // isExecuting:true flag. The lifecycle's currentState lives in a module
    // closure that resets to 'idle' on this store (re)creation; without this
    // seed the later markFinished/markCancelled transition is rejected from
    // 'idle' and isExecuting would be pinned true forever — a phantom run that
    // silently forces every subsequent run into background mode.
    executionLifecycle.markRecovered(set);

    const { activeExecutionId, executionPersonaId } = recoveredState;
    // Fire-and-forget -- reconciliation should not block store creation.
    void (async () => {
      try {
        const execution = await getExecution(activeExecutionId, executionPersonaId ?? activeExecutionId);
        if (TERMINAL_STATUS_SET.has(execution.status)) {
          logger.info("Recovered execution already finished — clearing stale state", { executionId: activeExecutionId, status: execution.status });
          executionLifecycle.markFinished(set);
          set({ activeExecutionId: null, lastExecutionId: activeExecutionId, executionPersonaId: null, isExecuting: false });
          try { localStorage.removeItem('personas:active-execution'); } catch (err) { silentCatch("stores/slices/agents/executionSlice:catch2")(err); }
        } else {
          logger.info("Recovered execution still active — keeping state", { executionId: activeExecutionId, status: execution.status });
        }
      } catch {
        // Backend unreachable — do NOT clear execution state. The execution may
        // still be running and consuming resources. Set a flag so the UI can
        // show a retry prompt instead of silently abandoning the job.
        logger.warn("Could not verify recovered execution — flagging for retry", { executionId: activeExecutionId });
        set({ executionVerificationFailed: true });
      }
    })();
  }

  // Deduplication: track in-flight fetch so concurrent callers reuse the same promise.
  let inflightFetch: { personaId: string; promise: Promise<void> } | null = null;
  // Monotonic guard: single-slot dedup only covers same-persona overlap, not an
  // A→B→A interleaving. Each fetch captures a seq; only the newest may write the
  // visible executions/loading state, so a slow earlier fetch can't clobber a
  // newer persona's list or flip the spinner off mid-load. The per-persona cache
  // is always written (it's keyed and correct regardless of order).
  let fetchExecSeq = 0;

  // Stable idempotency key for the single FOREGROUND run. Persisted (closure-
  // local, like inflightFetch) ACROSS a timeout+retry so the retry reuses the
  // key and the backend dedups instead of double-spawning. Keyed by a request
  // signature so a retry of the SAME request reuses the key, while a different
  // request or a deliberate re-run (after the slot is cleared on terminal)
  // mints a fresh one. Background (concurrent) runs never touch this slot.
  let pendingForegroundIdem: { signature: string; key: string; mintedAt: number } | null = null;

  return ({
    executions: [],
    executionsLoading: false,
    executionsError: false,
    executionsPersonaId: null,
    executionsCache: {},
    executionsCacheAt: {},
    activeExecutionId: recoveredState?.activeExecutionId ?? null,
    executionPersonaId: recoveredState?.executionPersonaId ?? null,
    activeUseCaseId: null,
    executionOutput: [],
    executionOutputBytes: 0,
    isExecuting: recoveredState?.isExecuting ?? false,
    executionProgress: null,
    pipelineTrace: null,
    queuePosition: null,
  queueDepth: null,
  designDriftEvents: loadDriftEvents(),
  lastExecutionId: null,
  backgroundExecutions: [],
  executionVerificationFailed: false,

  executePersona: async (personaId, inputData, useCaseId, continuation) => {
    const isAlreadyExecuting = get().isExecuting;

    // Budget enforcement: block execution when monthly spend exceeds budget
    // unless user has explicitly overridden for this session.
    if (get().isBudgetBlocked(personaId)) {
      set({ error: en.execution.budget_exceeded });
      return null;
    }

    // If another execution is already focused (has terminal output), this one
    // runs in the background — tracked for status but no terminal buffering.
    const runInBackground = isAlreadyExecuting;

    if (!runInBackground) {
      // Lock execution state immediately before any async work to close the
      // race-window where a second call could pass the isExecuting guard.
      executionSink.reset();
      executionLifecycle.markStarted(set);
      set({ executionOutput: [], executionOutputBytes: 0, executionPersonaId: personaId, activeUseCaseId: useCaseId ?? null });
    }

    // Track this persona as recently accessed so it appears in the sidebar Recent group.
    trackRecentAgent(personaId);

    // Pipeline: initiate stage
    let trace = createPipelineTrace('pending');
    trace = traceStage(trace, 'initiate', { personaId });

    // Run initiate middleware (future: cost estimation, pre-flight checks)
    const initiatePayload: InitiatePayload = { personaId, inputData, useCaseId };
    await runMiddleware('initiate', initiatePayload, trace);

    if (!runInBackground) {
      set({ pipelineTrace: trace, executionProgress: { phase: 'initiating', pipelineStage: 'initiate' } });
    }
    try {
      // Pipeline: validate stage -- middleware can enrich inputData (e.g. knowledge injection)
      trace = traceStage(trace, 'validate');
      const validateResult = await runMiddleware('validate', {
        personaId,
        personaName: '',
        triggerId: null,
        inputData: inputData ? JSON.stringify(inputData) : null,
        useCaseId: useCaseId ?? null,
        modelUsed: null,
      }, trace);

      // Idempotency key so that if the IPC times out and the user retries, the
      // backend returns the already-created execution instead of spawning a
      // duplicate. The key MUST be stable across a timeout+retry — a fresh
      // crypto.randomUUID() per call meant the backend's create_with_idempotency
      // never matched on the retry, so a SECOND execution spawned (double $).
      // We therefore reuse the pending key when this call is a retry of the same
      // logical request (same persona/useCase/input/continuation) within the
      // reuse window, and only mint a new key for a different request or a
      // deliberate re-run after the previous run reached terminal (the slot is
      // cleared in finishExecution / cancelExecution / clearExecutionOutput).
      // Background (concurrent) runs always mint fresh: they are explicitly the
      // user asking for ANOTHER simultaneous run, which must not dedup.
      let idempotencyKey: string;
      if (runInBackground) {
        idempotencyKey = crypto.randomUUID();
      } else {
        const signature = executionRequestSignature(personaId, useCaseId, inputData, continuation);
        const now = Date.now();
        if (
          pendingForegroundIdem &&
          pendingForegroundIdem.signature === signature &&
          now - pendingForegroundIdem.mintedAt < IDEMPOTENCY_REUSE_WINDOW_MS
        ) {
          // Retry of the same logical request → reuse so the backend returns
          // the already-spawned execution.
          idempotencyKey = pendingForegroundIdem.key;
        } else {
          // New request, deliberate re-run, or a stale slot → fresh key.
          idempotencyKey = crypto.randomUUID();
          pendingForegroundIdem = { signature, key: idempotencyKey, mintedAt: now };
        }
      }

      const execution = await executePersona(
        personaId,
        undefined,
        validateResult.inputData ?? (inputData ? JSON.stringify(inputData) : undefined),
        useCaseId,
        continuation,
        idempotencyKey,
      );

      // Pipeline: create_record stage
      trace = traceStage(trace, 'create_record', { executionId: execution.id });
      const createPayload: CreateRecordPayload = { executionId: execution.id, execution: execution as never };
      await runMiddleware('create_record', createPayload, trace);

      // Pipeline: spawn_engine stage
      trace = traceStage(trace, 'spawn_engine');
      const spawnPayload: SpawnEnginePayload = { executionId: execution.id, taskSpawned: true };
      await runMiddleware('spawn_engine', spawnPayload, trace);

      trace = { ...trace, executionId: execution.id };

      if (runInBackground) {
        // Track as background execution — no terminal output, just status
        const personas = (get() as unknown as { personas: Array<{ id: string; name: string; color: string }> }).personas ?? [];
        const persona = personas.find((p) => p.id === personaId);
        const bgExec: BackgroundExecution = {
          executionId: execution.id,
          personaId,
          personaName: persona?.name ?? 'Agent',
          personaColor: persona?.color ?? '#6B7280',
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        set((state) => ({ backgroundExecutions: [...state.backgroundExecutions, bgExec] }));
        logger.info("Execution started in background", { executionId: execution.id, personaId });
      } else {
        set({ activeExecutionId: execution.id, pipelineTrace: trace, executionProgress: { executionId: execution.id, phase: 'running', pipelineStage: 'spawn_engine' } });
        // Persist to localStorage for recovery after refresh
        try {
          localStorage.setItem('personas:active-execution', JSON.stringify({
            activeExecutionId: execution.id,
            executionPersonaId: personaId,
            isExecuting: true,
          }));
        } catch (err) { silentCatch("stores/slices/agents/executionSlice:catch3")(err); }
      }
      return execution.id;
    } catch (err) {
      trace = traceStage(trace, 'validate', undefined, String(err));
      trace = completeTrace(trace);
      if (!runInBackground) {
        // Keep the stable idempotency key ONLY on a timeout: the backend may
        // have spawned the run before the IPC deadline, so a retry must reuse
        // the key to re-attach instead of double-spawning. Any other failure
        // means the run did not start, so clear the slot — the user's next
        // click is a fresh request, not a retry.
        if (!(err instanceof InvokeTimeoutError)) {
          pendingForegroundIdem = null;
        }
        executionLifecycle.markFailed(set);
        reportError(err, "Failed to execute persona", set, { action: "executePersona", stateUpdates: { executionPersonaId: null, activeUseCaseId: null, pipelineTrace: trace } });
      } else {
        reportError(err, "Failed to execute persona in background", set, { action: "executePersonaBackground" });
      }
      return null;
    }
  },

  cancelExecution: async (executionId) => {
    try {
      const callerPersonaId = get().executionPersonaId ?? '';
      await cancelExecution(executionId, callerPersonaId);
      const trace = get().pipelineTrace;
      if (trace) {
        set({ pipelineTrace: completeTrace(traceStage(trace, 'finalize_status', { cancelled: true })) });
      }
    } catch (err) {
      reportError(err, "Failed to cancel execution", set, { action: "cancelExecution" });
    } finally {
      // If a chat stream is active, finalize it before clearing state. Use the
      // stream-pinned session/persona so a mid-stream thread switch can't make
      // this finalize into the wrong thread.
      const { chatStreaming: streaming, streamingChatSessionId: sid, streamingChatPersonaId: pid, executionOutput: out } = get();
      if (streaming && sid && pid) {
        const textLines = out.filter((l) => classifyLine(l) === 'text');
        const fullResponse = textLines.join('\n').trim();
        // Cancel is a non-completed terminal state — pass 'cancelled' so the
        // chat finalize surfaces an error instead of persisting the partial
        // (truncated) reply as an authoritative assistant answer (agent-chat #1).
        void get().finishChatStream(fullResponse, pid, sid, get().activeExecutionId ?? undefined, 'cancelled');
      }

      // Preserve the execution ID for Resume before clearing active state.
      const lastId = get().activeExecutionId;
      // Foreground run is being torn down — drop its stable idempotency key so
      // a subsequent identical request mints a fresh one.
      pendingForegroundIdem = null;
      // Always reset execution state regardless of API success/failure.
      executionLifecycle.markCancelled(set);
      set({ activeExecutionId: null, lastExecutionId: lastId, executionPersonaId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null, isExecuting: false });
      try { localStorage.removeItem('personas:active-execution'); } catch (err) { silentCatch("stores/slices/agents/executionSlice:catch4")(err); }
      const personaId = get().selectedPersona?.id;
      if (personaId) get().fetchExecutions(personaId);
    }
  },

  finishExecution: (_status, statusData) => {
    // Force-flush any pending batch so the final output is visible before
    // we reset execution state.
    executionSink.forceFlush();

    // Snapshot the output for this execution so DAG walkers can retrieve it
    // after the shared executionOutput array is cleared by the next run.
    // Snapshots live in a module-local Map (NOT store state) so finishExecution
    // doesn't churn the store tree on every completion. Evict oldest entries
    // beyond MAX_COMPLETED_SNAPSHOTS to prevent unbounded memory growth.
    const finishedExecId = get().activeExecutionId;
    if (finishedExecId) {
      const snapshot = [...get().executionOutput];
      completedOutputs.set(finishedExecId, snapshot);
      const now = Date.now();
      completedOutputFinishedAt.set(finishedExecId, now);

      // TTL sweep — drop any snapshot older than COMPLETED_OUTPUT_TTL_MS.
      for (const key of completedOutputs.keys()) {
        const finishedAt = completedOutputFinishedAt.get(key);
        if (finishedAt !== undefined && now - finishedAt > COMPLETED_OUTPUT_TTL_MS) {
          completedOutputs.delete(key);
          completedOutputFinishedAt.delete(key);
        }
      }

      // Cap-based eviction. Map iteration is insertion-ordered, so the first
      // keys are the oldest.
      while (completedOutputs.size > MAX_COMPLETED_SNAPSHOTS) {
        const oldest = completedOutputs.keys().next().value;
        if (oldest === undefined) break;
        completedOutputs.delete(oldest);
        completedOutputFinishedAt.delete(oldest);
      }
    }

    // If a chat stream is active, finalize it now -- this runs at the store
    // level so it works even when ChatTab is unmounted (e.g. user switched tabs).
    // Use the stream-pinned session/persona, NOT activeChatSessionId — the user
    // may have switched threads while the reply was streaming, and finalizing
    // against the live active session would misattribute the reply.
    const { chatStreaming, executionOutput: output, streamingChatSessionId, streamingChatPersonaId } = get();
    if (chatStreaming && streamingChatSessionId && streamingChatPersonaId) {
      const textLines = output.filter((l) => classifyLine(l) === 'text');
      const fullResponse = textLines.join('\n').trim();
      // Forward the terminal status so the chat finalize only persists a clean
      // assistant message when the turn actually 'completed'; failed/cancelled/
      // incomplete/unknown turns surface an error instead (agent-chat #1).
      void get().finishChatStream(fullResponse, streamingChatPersonaId, streamingChatSessionId, get().activeExecutionId ?? undefined, _status);
    }

    // Capture context for drift detection before resetting state.
    // Snapshot executions now so drift middleware doesn't read stale/wrong data
    // after the state reset below (the store's executions list may be refreshed
    // or belong to a different persona by the time middleware runs).
    const execPersonaId = get().executionPersonaId;
    const execId = get().activeExecutionId;
    const recentExecutions = execPersonaId
      ? get().executions
          .filter((e) => e.persona_id === execPersonaId)
          .slice(0, 4)
          .map((e) => ({ persona_id: e.persona_id, status: e.status }))
      : [];

    // Pipeline: frontend_complete stage
    let trace = get().pipelineTrace;
    if (trace) {
      trace = traceStage(trace, 'frontend_complete', { status: _status });
      trace = completeTrace(trace);
      set({ pipelineTrace: trace });
    }

    // Run frontend_complete middleware BEFORE resetting state so that
    // middleware (e.g. drift detection) can read persona data from the store
    // while execution context is still intact.
    if (trace) {
      const completePayload: FrontendCompletePayload = {
        executionId: execId ?? '',
        finalStatus: _status ?? '',
        personaId: execPersonaId ?? undefined,
        durationMs: statusData?.durationMs,
        costUsd: statusData?.costUsd,
        errorMessage: statusData?.errorMessage,
        recentExecutions,
      };
      void runMiddleware('frontend_complete', completePayload, trace).catch((err) => {
        logger.warn("frontend_complete middleware failed", { executionId: execId, personaId: execPersonaId, error: String(err) });
      });
    }

    // Foreground run reached terminal — drop its stable idempotency key so the
    // next identical request is treated as a deliberate fresh run, not a retry.
    pendingForegroundIdem = null;
    executionLifecycle.markFinished(set);
    // isExecuting:false is set defensively here (not only inside markFinished)
    // so the flag clears even if the FSM transition is rejected — e.g. a
    // recovered run whose lifecycle state could not be seeded. Without this a
    // rejected transition would pin isExecuting true and force all future runs
    // into background mode.
    set({ activeExecutionId: null, lastExecutionId: execId, executionPersonaId: null, activeUseCaseId: null, queuePosition: null, queueDepth: null, isExecuting: false });
    const personaId = get().selectedPersona?.id;
    if (personaId) get().fetchExecutions(personaId);
    // Health summaries are now pushed via PERSONA_HEALTH_CHANGED event from the backend

    // Clear recovery state
    try { localStorage.removeItem('personas:active-execution'); } catch (err) { silentCatch("stores/slices/agents/executionSlice:catch5")(err); }
  },

  // NOTE: keyed sibling of the createCachedFetch primitive
  // (src/lib/async/createCachedFetch.ts). Intentionally NOT migrated: its
  // freshness timestamp lives in slice state (executionsCacheAt) because
  // personaSlice's prefetch reads it (personaSlice.ts:252) — a cross-slice
  // contract the module-local primitive can't own. Generalizing the primitive
  // to a keyed value+timestamp store personaSlice can also read is a separate
  // refactor (see Architect ADR 2026-05-25-async-patterns-hardening).
  fetchExecutions: async (personaId) => {
    // Deduplicate: if already fetching for the same persona, reuse in-flight promise.
    if (inflightFetch && inflightFetch.personaId === personaId) {
      return inflightFetch.promise;
    }
    const cached = get().executionsCache[personaId];
    const cachedAt = get().executionsCacheAt[personaId] ?? 0;
    if (cached && Date.now() - cachedAt < EXECUTIONS_CACHE_TTL_MS) {
      set({
        executions: cached,
        executionsPersonaId: personaId,
        executionsLoading: false,
        executionsError: false,
      });
      return;
    }
    const seq = ++fetchExecSeq;
    const doFetch = async () => {
      set({ executionsLoading: true, executionsError: false });
      try {
        const executions = await listExecutionsSummary(personaId);
        const isLatest = seq === fetchExecSeq;
        set((state) => {
          const nextCache = { ...state.executionsCache, [personaId]: executions };
          const nextAt = { ...state.executionsCacheAt, [personaId]: Date.now() };
          // Bound the per-persona cache: across a long session of persona-
          // switching this would otherwise retain every persona's full execution
          // list. Keep the N most-recently-fetched, evict the rest by timestamp.
          const keys = Object.keys(nextCache);
          if (keys.length > EXECUTIONS_CACHE_MAX_PERSONAS) {
            keys.sort((a, b) => (nextAt[a] ?? 0) - (nextAt[b] ?? 0));
            for (const stale of keys.slice(0, keys.length - EXECUTIONS_CACHE_MAX_PERSONAS)) {
              if (stale === personaId) continue;
              delete nextCache[stale];
              delete nextAt[stale];
            }
          }
          // Always refresh the cache; only the newest fetch writes the VISIBLE
          // list/header so a stale resolution can't clobber a newer persona.
          return isLatest
            ? {
                executions,
                executionsPersonaId: personaId,
                executionsCache: nextCache,
                executionsCacheAt: nextAt,
              }
            : { executionsCache: nextCache, executionsCacheAt: nextAt };
        });
      } catch (err) {
        reportError(err, "Failed to fetch executions", set, { action: "fetchExecutions" });
        if (seq === fetchExecSeq) set({ executionsError: true });
      } finally {
        // Only the newest fetch owns the loading flag + dedup slot.
        if (seq === fetchExecSeq) {
          set({ executionsLoading: false });
          inflightFetch = null;
        }
      }
    };
    const promise = doFetch();
    inflightFetch = { personaId, promise };
    return promise;
  },

  appendExecutionOutput: (line) => {
    executionSink.append(line);
  },

  clearExecutionOutput: () => {
    // If an execution is still running, cancel it on the backend first to
    // avoid orphaning the engine (which would keep consuming API credits).
    const activeId = get().activeExecutionId;
    if (activeId && get().isExecuting) {
      get().cancelExecution(activeId);
    }
    executionSink.clear();
    // Drop any stable foreground idempotency key — the run is being abandoned.
    pendingForegroundIdem = null;
    executionLifecycle.markCancelled(set);
    set({ executionOutput: [], executionOutputBytes: 0, activeExecutionId: null, executionPersonaId: null, activeUseCaseId: null, pipelineTrace: null, queuePosition: null, queueDepth: null, isExecuting: false });
  },

  setQueueStatus: (position, depth) => {
    set({ queuePosition: position, queueDepth: depth });
  },

  setExecutionProgress: (progress) => {
    set({ executionProgress: progress });
  },

  dismissDriftEvent: (eventId) => {
    const updated = get().designDriftEvents.map((e) =>
      e.id === eventId ? { ...e, dismissed: true } : e,
    );
    saveDriftEvents(updated);
    set({ designDriftEvents: updated });
  },

  updateBackgroundExecution: (executionId, status) => {
    set((state) => ({
      backgroundExecutions: state.backgroundExecutions.map((bg) =>
        bg.executionId === executionId ? { ...bg, status } : bg,
      ),
    }));
  },

  removeBackgroundExecution: (executionId) => {
    set((state) => ({
      backgroundExecutions: state.backgroundExecutions.filter((bg) => bg.executionId !== executionId),
    }));
  },

  consumeCompletedOutput: (executionId) => {
    const output = completedOutputs.get(executionId);
    if (output) {
      completedOutputs.delete(executionId);
      completedOutputFinishedAt.delete(executionId);
    }
    return output;
  },

  retryExecutionVerification: async () => {
    const execId = get().activeExecutionId;
    const personaId = get().executionPersonaId;
    if (!execId) {
      set({ executionVerificationFailed: false });
      return;
    }
    try {
      const execution = await getExecution(execId, personaId ?? execId);
      set({ executionVerificationFailed: false });
      if (TERMINAL_STATUS_SET.has(execution.status)) {
        logger.info("Recovered execution already finished — clearing stale state", { executionId: execId, status: execution.status });
        executionLifecycle.markFinished(set);
        set({ activeExecutionId: null, lastExecutionId: execId, executionPersonaId: null, isExecuting: false });
        try { localStorage.removeItem('personas:active-execution'); } catch (err) { silentCatch("stores/slices/agents/executionSlice:catch6")(err); }
      } else {
        logger.info("Recovered execution still active — keeping state", { executionId: execId, status: execution.status });
      }
    } catch {
      logger.warn("Retry verification failed — backend still unreachable", { executionId: execId });
    }
  },

  dismissVerificationFailure: () => {
    const execId = get().activeExecutionId;
    logger.info("User dismissed verification failure — abandoning recovered execution", { executionId: execId });
    set({ executionVerificationFailed: false });
    executionLifecycle.markFinished(set);
    set({ activeExecutionId: null, lastExecutionId: execId, executionPersonaId: null, isExecuting: false });
    try { localStorage.removeItem('personas:active-execution'); } catch (err) { silentCatch("stores/slices/agents/executionSlice:catch7")(err); }
  },
});
};
