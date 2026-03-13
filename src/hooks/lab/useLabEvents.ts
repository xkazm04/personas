import { useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { sendAppNotification } from "@/api/system/system";
import type { LabRunStatus } from "@/lib/bindings/LabRunStatus";
import type { LabMode, LabRunProgress } from "@/stores/slices/agents/labSlice";
import { useRunEventListener, type RunStatusPayload, type RunEventBinding } from "@/hooks/realtime/useRunEventListener";

function mapPayload(p: RunStatusPayload, mode: LabMode): LabRunProgress {
  return {
    runId: p.run_id,
    mode,
    phase: p.phase,
    scenariosCount: p.scenarios_count,
    current: p.current,
    total: p.total,
    modelId: p.model_id,
    scenarioName: p.scenario_name,
    status: p.status as LabRunStatus | undefined,
    scores: p.scores,
    summary: p.summary,
    error: p.error,
  };
}

const MODE_LABELS: Record<LabMode, string> = {
  arena: "Arena",
  ab: "A/B Test",
  eval: "Evaluation",
  matrix: "Matrix",
  versions: "Versions",
};

function notifyTerminal(mode: LabMode, phase: string) {
  const label = MODE_LABELS[mode] ?? mode;
  if (phase === "completed") {
    sendAppNotification(`Lab ${label} Complete`, `${label} test finished successfully.`).catch(() => {});
  } else if (phase === "failed") {
    sendAppNotification(`Lab ${label} Failed`, `${label} test encountered an error.`).catch(() => {});
  }
}

export function useLabEvents() {
  const setLabProgress = useAgentStore((s) => s.setLabProgress);
  const finishLabRun = useAgentStore((s) => s.finishLabRun);

  const bindings = useMemo((): RunEventBinding[] => {
    const modes: { event: string; mode: LabMode }[] = [
      { event: "lab-arena-status", mode: "arena" },
      { event: "lab-ab-status", mode: "ab" },
      { event: "lab-matrix-status", mode: "matrix" },
      { event: "lab-eval-status", mode: "eval" },
    ];

    return modes.map(({ event, mode }) => ({
      eventName: event,
      onProgress: (p) => setLabProgress(mapPayload(p, mode)),
      onTerminal: (p) => {
        finishLabRun(mode);
        notifyTerminal(mode, p.phase);
      },
    }));
  }, [setLabProgress, finishLabRun]);

  useRunEventListener(bindings, [bindings]);
}
