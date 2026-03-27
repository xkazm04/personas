import { useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useRunEventListener, mapRunStatusPayload, type RunStatusPayload, type RunEventBinding } from "@/hooks/realtime/useRunEventListener";

export function usePersonaTests() {
  const setTestRunProgress = useAgentStore((s) => s.setTestRunProgress);
  const finishTestRun = useAgentStore((s) => s.finishTestRun);

  const bindings = useMemo((): RunEventBinding[] => [{
    eventName: "test-run-status",
    filter: (p: RunStatusPayload) => {
      const { isTestRunning, testRunProgress } = useAgentStore.getState();
      if (!isTestRunning) return false;
      const expectedRunId = testRunProgress?.runId;
      if (expectedRunId && p.run_id !== expectedRunId) return false;
      return true;
    },
    onProgress: (p) => {
      setTestRunProgress(mapRunStatusPayload(p));
    },
    onTerminal: () => {
      finishTestRun();
    },
  }], [setTestRunProgress, finishTestRun]);

  useRunEventListener(bindings, [bindings]);
}
