import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePersonaStore } from "@/stores/personaStore";
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

const TERMINAL_PHASES = ["completed", "failed", "cancelled"];

export function useLabEvents() {
  const setLabProgress = usePersonaStore((s) => s.setLabProgress);
  const finishLabRun = usePersonaStore((s) => s.finishLabRun);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    const setup = async () => {
      const listeners: UnlistenFn[] = [];

      // Arena events
      listeners.push(
        await listen<LabStatusPayload>("lab-arena-status", (event) => {
          const progress = mapPayload(event.payload, "arena");
          setLabProgress(progress);
          if (TERMINAL_PHASES.includes(event.payload.phase)) finishLabRun();
        }),
      );

      // A/B events
      listeners.push(
        await listen<LabStatusPayload>("lab-ab-status", (event) => {
          const progress = mapPayload(event.payload, "ab");
          setLabProgress(progress);
          if (TERMINAL_PHASES.includes(event.payload.phase)) finishLabRun();
        }),
      );

      // Matrix events
      listeners.push(
        await listen<LabStatusPayload>("lab-matrix-status", (event) => {
          const progress = mapPayload(event.payload, "matrix");
          setLabProgress(progress);
          if (TERMINAL_PHASES.includes(event.payload.phase)) finishLabRun();
        }),
      );

      // Eval events
      listeners.push(
        await listen<LabStatusPayload>("lab-eval-status", (event) => {
          const progress = mapPayload(event.payload, "eval");
          setLabProgress(progress);
          if (TERMINAL_PHASES.includes(event.payload.phase)) finishLabRun();
        }),
      );

      unlistenRef.current = listeners;
    };

    setup();

    return () => {
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
    };
  }, [setLabProgress, finishLabRun]);
}
