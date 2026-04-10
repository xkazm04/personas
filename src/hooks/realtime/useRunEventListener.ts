import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
          binding.onProgress(event.payload);
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

      await Promise.allSettled(registrations);

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
