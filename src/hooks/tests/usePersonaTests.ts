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
}

export function usePersonaTests() {
  const setTestRunProgress = usePersonaStore((s) => s.setTestRunProgress);
  const finishTestRun = usePersonaStore((s) => s.finishTestRun);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    const setup = async () => {
      const unlisten = await listen<TestRunStatusPayload>(
        "test-run-status",
        (event) => {
          const p = event.payload;

          setTestRunProgress({
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
          });

          if (["completed", "failed", "cancelled"].includes(p.phase)) {
            finishTestRun();
          }
        },
      );

      unlistenRef.current = [unlisten];
    };

    setup();

    return () => {
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
    };
  }, [setTestRunProgress, finishTestRun]);
}
