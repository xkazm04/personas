import { useMemo } from "react";
import { usePersonaStore } from "@/stores/personaStore";
import { useRunEventListener, type RunStatusPayload, type RunEventBinding } from "@/hooks/realtime/useRunEventListener";

export function usePersonaTests() {
  const setTestRunProgress = usePersonaStore((s) => s.setTestRunProgress);
  const finishTestRun = usePersonaStore((s) => s.finishTestRun);

  const bindings = useMemo((): RunEventBinding[] => [{
    eventName: "test-run-status",
    filter: (p: RunStatusPayload) => {
      const { isTestRunning, testRunProgress } = usePersonaStore.getState();
      if (!isTestRunning) return false;
      const expectedRunId = testRunProgress?.runId;
      if (expectedRunId && p.run_id !== expectedRunId) return false;
      return true;
    },
    onProgress: (p) => {
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
    },
    onTerminal: () => {
      finishTestRun();
    },
  }], [setTestRunProgress, finishTestRun]);

  useRunEventListener(bindings, [bindings]);
}
