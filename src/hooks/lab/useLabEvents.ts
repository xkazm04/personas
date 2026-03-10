<<<<<<< HEAD
import { useMemo } from "react";
import { usePersonaStore } from "@/stores/personaStore";
import { sendAppNotification } from "@/api/system";
import type { LabMode, LabRunProgress } from "@/stores/slices/labSlice";
import { useRunEventListener, type RunStatusPayload, type RunEventBinding } from "@/hooks/realtime/useRunEventListener";

function mapPayload(p: RunStatusPayload, mode: LabMode): LabRunProgress {
=======
import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePersonaStore } from "@/stores/personaStore";
import { sendAppNotification } from "@/api/system";
import type { LabMode, LabRunProgress } from "@/stores/slices/labSlice";

interface LabStatusPayload {
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

function mapPayload(p: LabStatusPayload, mode: LabMode): LabRunProgress {
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  return {
    runId: p.run_id,
    mode,
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
  };
}

<<<<<<< HEAD
=======
const TERMINAL_PHASES = ["completed", "failed", "cancelled"];

>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
  const setLabProgress = usePersonaStore((s) => s.setLabProgress);
  const finishLabRun = usePersonaStore((s) => s.finishLabRun);
<<<<<<< HEAD

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
=======
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let active = true;

    const setup = async () => {
      const listeners: UnlistenFn[] = [];
      const register = async (eventName: string, mode: LabMode) => {
        const unlisten = await listen<LabStatusPayload>(eventName, (event) => {
          const progress = mapPayload(event.payload, mode);
          setLabProgress(progress);
          if (TERMINAL_PHASES.includes(event.payload.phase)) {
            finishLabRun();
            notifyTerminal(mode, event.payload.phase);
          }
        });

        if (!active) {
          unlisten();
          return;
        }

        listeners.push(unlisten);
      };

      // Use allSettled so a single listener registration failure doesn't
      // prevent the remaining listeners from being set up.
      await Promise.allSettled([
        register("lab-arena-status", "arena"),
        register("lab-ab-status", "ab"),
        register("lab-matrix-status", "matrix"),
        register("lab-eval-status", "eval"),
      ]);

      if (!active) {
        listeners.forEach((unlisten) => unlisten());
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
  }, [setLabProgress, finishLabRun]);
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
}
