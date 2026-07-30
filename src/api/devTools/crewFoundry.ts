// Crew Foundry API — forge a project-scoped persona crew from the project's
// own telemetry (pulse + context heat + passport gaps + off-track KPIs) and
// read back per-persona assignment fitness.
//
// Types mirror the Rust structs in
// src-tauri/src/commands/design/team_synthesis.rs (camelCase serde). Declared
// locally rather than imported from @/lib/bindings so the frontend compiles
// before the next ts-rs export run.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { TeamSynthesisResult } from "@/lib/bindings/TeamSynthesisResult";

export interface ProjectPulseSnapshot {
  day: string;
  narrativeMd: string;
  tensions: string[];
  directions: string[];
}

export interface CrewFitnessPersona {
  personaId: string;
  personaName: string;
  role: string;
  stepsDone: number;
  stepsFailed: number;
  /** done + failed — skipped steps carry no fitness signal. */
  stepsTotal: number;
  /** done / (done + failed); null until at least one terminal step exists. */
  successRate: number | null;
}

export interface CrewFitnessReport {
  teamId: string;
  teamName: string;
  /** Set when the team was forged by the Crew Foundry (provenance badge). */
  forgedFromProjectId: string | null;
  forgedAt: string | null;
  personas: CrewFitnessPersona[];
}

/** Most recent pulse snapshots for a project, newest first (empty when
 *  project tracking has never produced a pulse). */
export const getProjectPulseSnapshots = (projectId: string, limit?: number) =>
  invoke<ProjectPulseSnapshot[]>("get_project_pulse_snapshots", { projectId, limit });

/** Forge a project-scoped crew from a compiled brief. One Sonnet call plus
 *  team assembly — allow well past the backend's 120s LLM timeout. */
export const synthesizeProjectCrew = (
  projectId: string,
  brief: string,
  roleDirectives: string[],
  teamName: string,
) =>
  invoke<TeamSynthesisResult>(
    "synthesize_project_crew",
    { projectId, brief, roleDirectives, teamName },
    { timeoutMs: 180_000 },
  );

/** Member roster + per-persona assignment success rate for a team. */
export const getCrewFitness = (teamId: string) =>
  invoke<CrewFitnessReport>("get_crew_fitness", { teamId });
