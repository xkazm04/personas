import { useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from "@/stores/agentStore";
import { silentCatch } from "@/lib/silentCatch";
import { useCorrelatedCliStream } from './useCorrelatedCliStream';
import { EventName } from '@/lib/eventRegistry';
import { traceStage, runMiddleware, type FinalizeStatusPayload } from '@/lib/execution/pipeline';
import {
  canTransition,
  isTerminalExecutionState,
  isTerminalState,
  parseExecutionState,
  type ExecutionState,
  type TerminalExecutionState,
} from '@/lib/execution/executionState';
import { validatePayload, ExecutionStatusSchema, type ExecutionStatusPayload } from '@/lib/validation/eventPayloads';
import type { QueueStatusPayload } from '@/stores/slices/agents/executionSlice';
import { getExecutionLogLines } from '@/api/agents/executions';
import { checkNewHumanReviews } from '@/lib/notifications/checkHumanReviews';

/**
 * Page size for the reload recovery replay.
 *
 * `get_execution_log_lines` (src-tauri/src/commands/execution/executions.rs)
 * has TWO modes and they are selected by whether `offset` is present, not by
 * whether `limit` is: with no offset it returns the LAST `limit ?? 500`
 * matching lines (tail mode, ring-buffered); with an offset it pages forward.
 * The recovery replay called it with neither argument, so it silently asked
 * for the tail — a run that had produced more than 500 lines before the reload
 * came back with only its last 500 and everything above them was gone from the
 * transcript, with nothing in the UI saying so. 500 matches the backend's own
 * default, so a short run still costs exactly one round trip.
 */
const RECOVERY_PAGE_SIZE = 500;

/**
 * Ceiling on lines pulled back by the replay. `MAX_TERMINAL_LINES` in
 * `executionSink.ts` is 10,000 and the sink evicts past it (announcing the
 * truncation), so pulling more would be work whose result is dropped one call
 * later. It is also the loop's liveness guarantee: a backend that somehow
 * returned a full page forever terminates here rather than paging without end.
 */
const RECOVERY_MAX_LINES = 10_000;

/**
 * Read a run's whole persisted transcript by paging FORWARD from offset 0.
 *
 * Stops on the first short page (the documented end-of-stream signal for this
 * command) or at `RECOVERY_MAX_LINES`, whichever comes first.
 */
async function fetchLogLinesPaged(execId: string, personaId: string): Promise<string[]> {
  const all: string[] = [];
  for (let offset = 0; offset < RECOVERY_MAX_LINES; offset += RECOVERY_PAGE_SIZE) {
    const page = await getExecutionLogLines(execId, personaId, offset, RECOVERY_PAGE_SIZE);
    all.push(...page);
    // A short page means the backend ran out of matching lines. An empty page
    // is the same signal and is covered by the same test.
    if (page.length < RECOVERY_PAGE_SIZE) break;
  }
  return all.length > RECOVERY_MAX_LINES ? all.slice(0, RECOVERY_MAX_LINES) : all;
}

export function usePersonaExecution() {
  const { clearOutput, activeExecutionId, selectedPersonaId } = useAgentStore(useShallow((s) => ({
    clearOutput: s.clearExecutionOutput,
    activeExecutionId: s.activeExecutionId,
    selectedPersonaId: s.selectedPersonaId,
  })));
  const prevExecIdRef = useRef<string | null>(null);
  const prevPersonaIdRef = useRef<string | null>(null);
  const streamTracedRef = useRef(false);
  const queueUnlistenRef = useRef<UnlistenFn | null>(null);
  // True when the focused execution's correlated CLI stream has been torn down
  // by a persona switch while activeExecutionId is still set. While detached,
  // the background EXECUTION_STATUS listener finalizes the owning run's terminal
  // event (execution-runner #2). Reset when a fresh execution attaches its stream.
  const focusedStreamDetachedRef = useRef(false);
  /**
   * Last execution state observed for the focused run, so an illegal edge
   * (`completed -> running`, a second terminal event, a backwards hop) can be
   * NAMED. Null until the first status event of a run; reset when a fresh
   * execution attaches its stream.
   */
  const lastStateRef = useRef<ExecutionState | null>(null);

  /** Guard: returns true when the executing persona still matches the selected persona. */
  const isOwnerAligned = (): boolean => {
    const s = useAgentStore.getState();
    // If there's no execution persona or no selection, allow (startup / teardown edge cases)
    if (!s.executionPersonaId || !s.selectedPersonaId) return true;
    return s.executionPersonaId === s.selectedPersonaId;
  };

  const handleOutputLine = useCallback((line: string) => {
    if (!isOwnerAligned()) return;
    const store = useAgentStore.getState();
    // Pipeline: trace stream_output on first output line
    if (!streamTracedRef.current && store.pipelineTrace) {
      streamTracedRef.current = true;
      useAgentStore.setState((state) => ({
        pipelineTrace: state.pipelineTrace
          ? traceStage(state.pipelineTrace, 'stream_output')
          : null,
      }));
    }
    store.appendExecutionOutput(line);
  }, []);

  /**
   * Finalize a TERMINAL status event for the owning execution: trace + run the
   * finalize_status middleware, surface any error line, then call finishExecution
   * (which clears activeExecutionId / isExecuting / the recovery key on EVERY
   * terminal state). Factored out of handleStatusEvent so the background listener
   * can reuse it when the focused stream has been detached by a persona switch
   * (execution-runner #2). Neither caller is gated on owner-alignment here,
   * because a run navigated away from must still finalize.
   */
  const finalizeTerminalStatus = useCallback((validated: ExecutionStatusPayload, status: TerminalExecutionState) => {
    const { error, duration_ms, cost_usd } = validated;
    const store = useAgentStore.getState();

    // Pipeline: trace finalize_status
    if (store.pipelineTrace) {
      useAgentStore.setState((state) => ({
        pipelineTrace: state.pipelineTrace
          ? traceStage(state.pipelineTrace, 'finalize_status', {
            status,
            durationMs: duration_ms ?? null,
            costUsd: cost_usd ?? null,
          })
          : null,
      }));

      // Run finalize_status middleware (fire-and-forget -- non-blocking)
      const trace = useAgentStore.getState().pipelineTrace;
      if (trace) {
        const finalizePayload: FinalizeStatusPayload = {
          executionId: store.activeExecutionId ?? '',
          status,
          error: error ?? null,
          durationMs: duration_ms ?? null,
          costUsd: cost_usd ?? null,
        };
        void runMiddleware('finalize_status', finalizePayload, trace).catch(silentCatch('hooks/execution/usePersonaExecution:finalizeStatusMiddleware'));
      }
    }
    if (error) {
      store.appendExecutionOutput(`[ERROR] ${error}`);
    }

    // Capture persona info before finishExecution resets state
    const execPersonaId = store.executionPersonaId;
    const execPersonaName = store.selectedPersona?.name ?? null;

    store.finishExecution(status, {
      durationMs: duration_ms ?? null,
      costUsd: cost_usd ?? null,
      errorMessage: error ?? null,
    });

    // After successful execution, check for new human reviews
    if (status === 'completed' && execPersonaId) {
      void checkNewHumanReviews(execPersonaId, execPersonaName).catch(silentCatch('hooks/execution/usePersonaExecution:checkNewHumanReviews'));
    }
  }, []);

  const handleStatusEvent = useCallback((raw: Record<string, unknown>) => {
    if (!isOwnerAligned()) return;

    const validated = validatePayload('execution-status', raw, ExecutionStatusSchema);
    if (!validated) return;

    // ONE DOOR. The raw event field is a bare string (the payload validator has
    // no enum arm -- see ExecutionStatusSchema's docblock for why that is
    // deliberate); it is narrowed to the closed `ExecutionState` union HERE and
    // nowhere else. Before this, `status` travelled as a string all the way to
    // `finishExecution(status?: string)` and was finally ASSERTED into
    // `TerminalStatus` at the middleware payload -- so a malformed token tore
    // down a live run's UI under the name of a real outcome instead of being
    // named once as `unknown`.
    const state = parseExecutionState(validated.status);

    // Correlate by execution id: drop events that belong to a different run than
    // the focused one. Owner-alignment alone can't distinguish two runs of the
    // same persona, so a late/duplicated terminal event for a PRIOR run could
    // tear down the live run's UI (clear activeExecutionId, stop output, drop the
    // recovery key) while it keeps running headless (bug-hunt 2026-06-07
    // execution #5). When no execution id is present (legacy) or no run is active,
    // fall through to preserve prior behavior.
    const eventExecId = raw.execution_id as string | undefined;
    const focusedExecId = useAgentStore.getState().activeExecutionId;
    if (eventExecId && focusedExecId && eventExecId !== focusedExecId) return;

    // Transition check -- LOG-ONLY, on purpose, for now.
    //
    // `VALID_TRANSITIONS` has never had a consumer, so we have no field
    // evidence for how often the backend emits an edge it does not declare
    // (duplicate terminals, a `running` after a `completed` from a retried
    // process, a queued->completed shortcut). Blocking an unmodelled-but-real
    // edge would wedge a run that is otherwise fine, which is a strictly worse
    // failure than the one we are fixing. So the machine is made LOAD-BEARING
    // in the sense that matters first: every transition is now measured and
    // named. Promote this to a hard reject only once the log is quiet.
    const prev = lastStateRef.current;
    if (prev !== null && prev !== state && !canTransition(prev, state)) {
      silentCatch('hooks/execution/usePersonaExecution:illegalTransition')(
        new Error(`Illegal execution transition ${prev} -> ${state}`),
      );
    }
    lastStateRef.current = state;

    // When promoted from queue to running, clear queue position
    if (state === 'running') {
      useAgentStore.getState().setQueueStatus(null, null);
    }

    if (!isTerminalExecutionState(state)) return;

    finalizeTerminalStatus(validated, state);
  }, [finalizeTerminalStatus]);

  const { start, cleanup } = useCorrelatedCliStream({
    outputEvent: EventName.EXECUTION_OUTPUT,
    statusEvent: EventName.EXECUTION_STATUS,
    idField: 'execution_id',
    onOutputLine: handleOutputLine,
    onStatusEvent: handleStatusEvent,
    // The execution store (executionSlice) is the single source of truth for
    // terminal output. Disable the hook's own 5000-line buffer to prevent
    // duplicate memory usage and divergent trim points.
    bufferLines: false,
  });

  // Recovery: replay missed output lines after page reload
  const recoveryAttemptedRef = useRef(false);
  useEffect(() => {
    if (recoveryAttemptedRef.current) return;
    const store = useAgentStore.getState();
    const execId = store.activeExecutionId;
    const personaId = store.executionPersonaId;
    if (!execId || !store.isExecuting || !personaId) return;

    recoveryAttemptedRef.current = true;

    // Replay log lines that were missed during reload, deduplicating against
    // lines already delivered by the real-time event bus stream.
    fetchLogLinesPaged(execId, personaId)
      .then((lines) => {
        const current = useAgentStore.getState().executionOutput;
        // Build a counted set so legitimately repeated identical lines are
        // handled correctly -- each existing occurrence "claims" one recovery
        // line, and only truly new lines are appended.
        const seen = new Map<string, number>();
        for (const existing of current) {
          seen.set(existing, (seen.get(existing) ?? 0) + 1);
        }

        const sink = useAgentStore.getState().appendExecutionOutput;
        for (const line of lines) {
          const count = seen.get(line) ?? 0;
          if (count > 0) {
            seen.set(line, count - 1);
          } else {
            sink(line);
          }
        }
      })
      .catch(silentCatch('hooks/execution/usePersonaExecution:replayRecovery'));
  }, []);

  // Listen for queue-status events only while an execution is active.
  // This avoids registering idle listeners on the Tauri IPC bridge when
  // users are browsing agents without running them.
  useEffect(() => {
    if (!activeExecutionId) {
      // No execution -- tear down any lingering listener
      if (queueUnlistenRef.current) {
        queueUnlistenRef.current();
        queueUnlistenRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const setup = async () => {
      // Clean up previous listener before setting up new one
      if (queueUnlistenRef.current) {
        queueUnlistenRef.current();
        queueUnlistenRef.current = null;
      }

      const unlisten = await listen<QueueStatusPayload>(EventName.QUEUE_STATUS, (event) => {
        if (cancelled) return;
        const payload = event.payload;
        const store = useAgentStore.getState();
        if (store.activeExecutionId !== payload.execution_id) return;

        if (payload.action === 'queued') {
          store.setQueueStatus(payload.position, payload.queue_depth);
          store.appendExecutionOutput(`[QUEUE] Position ${(payload.position ?? 0) + 1} of ${payload.queue_depth} in queue`);
        } else if (payload.action === 'promoted') {
          store.setQueueStatus(null, null);
          store.appendExecutionOutput('[QUEUE] Promoted to running slot');
        }
      });

      if (!cancelled) {
        queueUnlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    };
    void setup();

    return () => {
      cancelled = true;
      if (queueUnlistenRef.current) {
        queueUnlistenRef.current();
        queueUnlistenRef.current = null;
      }
    };
  }, [activeExecutionId]);

  // Disconnect listeners when persona changes to prevent cross-contamination.
  // The execution keeps running in the backend; we just stop piping its output
  // into the terminal that now belongs to a different persona.
  useEffect(() => {
    if (selectedPersonaId !== prevPersonaIdRef.current) {
      if (prevPersonaIdRef.current !== null) {
        const store = useAgentStore.getState();
        if (store.executionPersonaId && store.executionPersonaId !== selectedPersonaId) {
          void cleanup();
          // The correlated stream that owns handleStatusEvent for the active run
          // is now torn down, but the run keeps going in the backend and
          // activeExecutionId stays set. Flag it so the background
          // EXECUTION_STATUS listener finalizes its terminal event
          // (execution-runner #2) — otherwise the event is handled by neither
          // listener and isExecuting sticks for up to 30 min.
          if (store.activeExecutionId) {
            focusedStreamDetachedRef.current = true;
          }
        }
      }
      prevPersonaIdRef.current = selectedPersonaId;
    }
  }, [selectedPersonaId, cleanup]);

  // Start listening whenever a new execution begins
  useEffect(() => {
    if (activeExecutionId && activeExecutionId !== prevExecIdRef.current) {
      prevExecIdRef.current = activeExecutionId;
      streamTracedRef.current = false;
      // A fresh focused stream is being attached for this execution; clear any
      // detached flag left over from a previous run's persona switch.
      focusedStreamDetachedRef.current = false;
      // A fresh run starts with no observed state, so its first status event
      // is never reported as an illegal edge off the previous run's terminal.
      lastStateRef.current = null;
      void start(activeExecutionId);
    }
  }, [activeExecutionId, start]);

  // Background execution status listener: catches status events for executions
  // that are running in the background (not the focused terminal execution).
  const bgUnlistenRef = useRef<UnlistenFn | null>(null);
  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      if (bgUnlistenRef.current) { bgUnlistenRef.current(); bgUnlistenRef.current = null; }

      const unlisten = await listen<Record<string, unknown>>(EventName.EXECUTION_STATUS, (event) => {
        if (cancelled) return;
        const payload = event.payload;
        const execId = payload.execution_id as string | undefined;
        if (!execId) return;

        const store = useAgentStore.getState();
        // The focused execution is normally finalized by the correlated CLI
        // stream's handleStatusEvent. But when the user navigates to another
        // persona mid-run, that stream is torn down while activeExecutionId is
        // still set — the terminal event would then be caught by NEITHER listener,
        // pinning isExecuting for up to RUN_MAX_DURATION_MS and forcing every new
        // run into background mode (execution-runner #2). When the focused stream
        // has been detached, finalize the owning run HERE, regardless of which
        // persona is now selected, so activeExecutionId / isExecuting / the
        // recovery key always clear on terminal.
        if (store.activeExecutionId === execId) {
          if (!focusedStreamDetachedRef.current) return; // stream still live → it finalizes
          const validated = validatePayload('execution-status', payload, ExecutionStatusSchema);
          if (!validated) return;
          // Same one door as handleStatusEvent: parse, never assert.
          const detachedState = parseExecutionState(validated.status);
          if (!isTerminalExecutionState(detachedState)) return; // only terminal finalizes a detached run
          finalizeTerminalStatus(validated, detachedState);
          return;
        }

        // Check if this is a tracked background execution
        const bg = store.backgroundExecutions.find((b) => b.executionId === execId);
        if (!bg) return;

        // Same one door again: a background run's status is parsed, not cast.
        // `parseExecutionState` takes `string | null | undefined`, so the raw
        // field needs no assertion to reach it.
        const status = parseExecutionState(
          typeof payload.status === 'string' ? payload.status : null,
        );
        if (isTerminalState(status)) {
          // `incomplete` (abandoned by a dead process) collapses to 'failed'
          // here DELIBERATELY: this drives a transient badge that fades after
          // 10 s, and the badge union has three arms. That is a display choice.
          //
          // It is not the same as the collapse in the reliability queries, where
          // `incomplete` is omitted from 14 of 22 terminal-set tests and the
          // result is a success rate that silently excludes lost runs — while
          // the spend predicate counts them. Do not cite this line as precedent
          // for that one.
          const mapped = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed';
          store.updateBackgroundExecution(execId, mapped);
          // Auto-remove after 10 seconds so the badge fades
          setTimeout(() => { useAgentStore.getState().removeBackgroundExecution(execId); }, 10_000);
          // Refresh execution list for the persona
          const personaId = store.selectedPersona?.id;
          if (personaId) store.fetchExecutions(personaId);
        } else if (status === 'running') {
          store.updateBackgroundExecution(execId, 'running');
        }
      });

      if (!cancelled) { bgUnlistenRef.current = unlisten; } else { unlisten(); }
    };
    void setup();
    return () => { cancelled = true; if (bgUnlistenRef.current) { bgUnlistenRef.current(); bgUnlistenRef.current = null; } };
    // finalizeTerminalStatus is a stable useCallback — listed to satisfy
    // exhaustive-deps; its identity never changes so the listener registers once.
  }, [finalizeTerminalStatus]);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  const disconnect = useCallback(() => {
    void cleanup();
  }, [cleanup]);

  return { disconnect, clearOutput };
}
