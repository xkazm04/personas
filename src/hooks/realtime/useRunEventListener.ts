import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { silentCatch } from "@/lib/silentCatch";

const TERMINAL_PHASES = ["completed", "failed", "cancelled"];

export interface RunStatusPayload {
  run_id: string;
  phase: string;
  scenarios_count?: number;
  current?: number;
  total?: number;
  model_id?: string;
  scenario_name?: string;
  status?: string;
  scores?: { tool_accuracy?: number; output_quality?: number; protocol_compliance?: number };
  summary?: Record<string, unknown>;
  error?: string;
  elapsed_ms?: number;
  scenarios?: unknown[];
}

/**
 * Shared snake_case → camelCase mapper for RunStatusPayload fields.
 * Used by both test-run and lab-run event handlers to ensure consistent field coverage.
 */
export function mapRunStatusPayload(p: RunStatusPayload) {
  return {
    runId: p.run_id,
    phase: p.phase,
    scenariosCount: p.scenarios_count,
    current: p.current,
    total: p.total,
    modelId: p.model_id,
    scenarioName: p.scenario_name,
    status: p.status,
    scores: p.scores,
    summary: p.summary,
    error: p.error,
    elapsedMs: p.elapsed_ms,
    scenarios: p.scenarios,
  };
}

export interface RunEventBinding<T extends RunStatusPayload = RunStatusPayload> {
  eventName: string;
  /** Return false to skip this event (e.g. stale run filtering). */
  filter?: (payload: T) => boolean;
  onProgress: (payload: T) => void;
  onTerminal: (payload: T) => void;
}

/**
 * Generic Tauri event listener for run-status events.
 * Handles subscription setup, terminal-phase detection, and cleanup.
 */
export function useRunEventListener<T extends RunStatusPayload = RunStatusPayload>(
  bindings: RunEventBinding<T>[],
) {
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let active = true;

    const setup = async () => {
      const listeners: UnlistenFn[] = [];

      const registrations = bindings.map(async (binding) => {
        const unlisten = await listen<T>(binding.eventName, (event) => {
          if (binding.filter && !binding.filter(event.payload)) return;
          // A throwing progress handler must not swallow the terminal edge:
          // onTerminal is what clears the run's "running" state (labSlice
          // finishLabRun), so skipping it leaves the run spinning forever.
          try {
            binding.onProgress(event.payload);
          } catch (err) {
            silentCatch(`hooks/realtime/useRunEventListener:${binding.eventName}:onProgress`)(err);
          }
          if (TERMINAL_PHASES.includes(event.payload.phase)) {
            binding.onTerminal(event.payload);
          }
        });

        if (!active) {
          unlisten();
          return;
        }
        listeners.push(unlisten);
      });

      const settled = await Promise.allSettled(registrations);
      // A binding whose listen() rejected receives nothing for the rest of
      // the mount. allSettled kept its siblings alive but dropped the reason
      // on the floor, so a dead channel looked exactly like an idle one.
      settled.forEach((r, i) => {
        if (r.status === "rejected") {
          silentCatch(`hooks/realtime/useRunEventListener:${bindings[i]!.eventName}:attach`)(r.reason);
        }
      });

      if (!active) {
        listeners.forEach((fn) => fn());
        return;
      }
      unlistenRef.current = listeners;
    };

    void setup();

    return () => {
      active = false;
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
    };
    // bindings should be memoized by callers (e.g. via useMemo) to avoid
    // listener churn. We use bindings directly so the effect re-subscribes
    // only when the memoized array changes.
  }, [bindings]); // bindings is memoized by callers — intentionally sparse deps
}
