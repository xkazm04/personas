import { useMemo, useRef } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { sendAppNotification } from "@/api/system/system";
import type { LabRunStatus } from "@/lib/bindings/LabRunStatus";
import type { LabMode, LabRunProgress } from "@/stores/slices/agents/labSlice";
import { useRunEventListener, mapRunStatusPayload, type RunStatusPayload, type RunEventBinding } from "@/hooks/realtime/useRunEventListener";
import { silentCatch } from "@/lib/silentCatch";
import { useTranslation, interpolate as tx } from "@/i18n/useTranslation";

function mapPayload(p: RunStatusPayload, mode: LabMode): LabRunProgress {
  return {
    ...mapRunStatusPayload(p),
    mode,
    status: p.status as LabRunStatus | undefined,
  };
}

type LabCopy = ReturnType<typeof useTranslation>["t"]["agents"]["lab"];

function modeLabel(copy: LabCopy, mode: LabMode): string {
  const labels: Record<LabMode, string> = {
    arena: copy.notify_mode_arena,
    ab: copy.notify_mode_ab,
    eval: copy.notify_mode_eval,
    matrix: copy.notify_mode_matrix,
    breed: copy.notify_mode_breed,
    evolve: copy.notify_mode_evolve,
    versions: copy.notify_mode_versions,
    regression: copy.notify_mode_regression,
  };
  return labels[mode] ?? mode;
}

// An OS notification is never re-rendered, so its copy is resolved at send time.
function notifyTerminal(copy: LabCopy, mode: LabMode, phase: string) {
  const label = modeLabel(copy, mode);
  if (phase === "completed") {
    sendAppNotification(tx(copy.notify_complete_title, { mode: label }), tx(copy.notify_complete_body, { mode: label })).catch(silentCatch('hooks/lab/useLabEvents:notifyCompleted'));
  } else if (phase === "failed") {
    sendAppNotification(tx(copy.notify_failed_title, { mode: label }), tx(copy.notify_failed_body, { mode: label })).catch(silentCatch('hooks/lab/useLabEvents:notifyFailed'));
  }
}

export function useLabEvents() {
  // Reading the section during render also starts its lazy load.
  const { t } = useTranslation();
  const copyRef = useRef(t.agents.lab);
  copyRef.current = t.agents.lab;
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
        notifyTerminal(copyRef.current, mode, p.phase);
      },
    }));
  }, [setLabProgress, finishLabRun]);

  useRunEventListener(bindings);
}
