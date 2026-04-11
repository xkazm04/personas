import { useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { sendAppNotification } from "@/api/system/system";
import type { LabRunStatus } from "@/lib/bindings/LabRunStatus";
import type { LabMode, LabRunProgress } from "@/stores/slices/agents/labSlice";
import { useRunEventListener, mapRunStatusPayload, type RunStatusPayload, type RunEventBinding } from "@/hooks/realtime/useRunEventListener";
import { createLogger } from "@/lib/log";

const logger = createLogger("lab-events");

function mapPayload(p: RunStatusPayload, mode: LabMode): LabRunProgress {
  return {
    ...mapRunStatusPayload(p),
    mode,
    status: p.status as LabRunStatus | undefined,
  };
}

const MODE_LABELS: Record<LabMode, string> = {
  arena: "Arena",
  ab: "A/B Test",
  eval: "Evaluation",
  matrix: "Matrix",
  breed: "Breed",
  evolve: "Evolution",
  versions: "Versions",
  regression: "Regression",
};

function notifyTerminal(mode: LabMode, phase: string) {
  const label = MODE_LABELS[mode] ?? mode;
  if (phase === "completed") {
    sendAppNotification(`Lab ${label} Complete`, `${label} test finished successfully.`).catch((err) => { logger.warn('Notification failed', { err: err instanceof Error ? err.message : String(err) }); });
  } else if (phase === "failed") {
    sendAppNotification(`Lab ${label} Failed`, `${label} test encountered an error.`).catch((err) => { logger.warn('Notification failed', { err: err instanceof Error ? err.message : String(err) }); });
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

  useRunEventListener(bindings);
}
