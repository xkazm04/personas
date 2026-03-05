import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePersonaStore } from "@/stores/personaStore";

interface TestRunStatusPayload {
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
  scenarios?: unknown[];
}

export function usePersonaTests() {
  const setTestRunProgress = usePersonaStore((s) => s.setTestRunProgress);
  const finishTestRun = usePersonaStore((s) => s.finishTestRun);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const unlisten = await listen<TestRunStatusPayload>(
        "test-run-status",
        (event) => {
          const p = event.payload;
          const { isTestRunning, testRunProgress } = usePersonaStore.getState();
          const expectedRunId = testRunProgress?.runId;

          // Ignore stale/global events when no run is active.
          if (!isTestRunning) return;

          // Once a run is known, only accept events for that specific run.
          if (expectedRunId && p.run_id !== expectedRunId) return;

          setTestRunProgress({
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
            scenarios: p.scenarios,
          });

          if (["completed", "failed", "cancelled"].includes(p.phase)) {
            finishTestRun();
          }
        },
      );

      if (cancelled) {
        unlisten();
        return;
      }

      unlistenRef.current = [unlisten];
    };

    setup();

    return () => {
      cancelled = true;
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
    };
  }, [setTestRunProgress, finishTestRun]);
}
