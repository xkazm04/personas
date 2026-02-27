import { invoke } from "@tauri-apps/api/core";

import type { LabArenaRun } from "@/lib/bindings/LabArenaRun";
import type { LabArenaResult } from "@/lib/bindings/LabArenaResult";
import type { LabAbRun } from "@/lib/bindings/LabAbRun";
import type { LabAbResult } from "@/lib/bindings/LabAbResult";
import type { LabMatrixRun } from "@/lib/bindings/LabMatrixRun";
import type { LabMatrixResult } from "@/lib/bindings/LabMatrixResult";
import type { LabEvalRun } from "@/lib/bindings/LabEvalRun";
import type { LabEvalResult } from "@/lib/bindings/LabEvalResult";
import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";
import type { Persona } from "@/lib/bindings/Persona";
import type { ModelTestConfig } from "./tests";

// ============================================================================
// Arena — Multi-model comparison
// ============================================================================

export const labStartArena = (personaId: string, models: ModelTestConfig[], useCaseFilter?: string) =>
  invoke<LabArenaRun>("lab_start_arena", { personaId, models, useCaseFilter: useCaseFilter ?? null });

export const labListArenaRuns = (personaId: string, limit?: number) =>
  invoke<LabArenaRun[]>("lab_list_arena_runs", { personaId, limit: limit ?? null });

export const labGetArenaResults = (runId: string) =>
  invoke<LabArenaResult[]>("lab_get_arena_results", { runId });

export const labDeleteArenaRun = (id: string) =>
  invoke<boolean>("lab_delete_arena_run", { id });

export const labCancelArena = (id: string) =>
  invoke<void>("lab_cancel_arena", { id });

// ============================================================================
// A/B — Prompt version comparison
// ============================================================================

export const labStartAb = (
  personaId: string,
  versionAId: string,
  versionBId: string,
  models: ModelTestConfig[],
  useCaseFilter?: string,
  testInput?: string,
) =>
  invoke<LabAbRun>("lab_start_ab", {
    personaId,
    versionAId,
    versionBId,
    models,
    useCaseFilter: useCaseFilter ?? null,
    testInput: testInput ?? null,
  });

export const labListAbRuns = (personaId: string, limit?: number) =>
  invoke<LabAbRun[]>("lab_list_ab_runs", { personaId, limit: limit ?? null });

export const labGetAbResults = (runId: string) =>
  invoke<LabAbResult[]>("lab_get_ab_results", { runId });

export const labDeleteAbRun = (id: string) =>
  invoke<boolean>("lab_delete_ab_run", { id });

export const labCancelAb = (id: string) =>
  invoke<void>("lab_cancel_ab", { id });

// ============================================================================
// Matrix — Draft generation + comparison
// ============================================================================

export const labStartMatrix = (
  personaId: string,
  instruction: string,
  models: ModelTestConfig[],
  useCaseFilter?: string,
) =>
  invoke<LabMatrixRun>("lab_start_matrix", {
    personaId,
    userInstruction: instruction,
    models,
    useCaseFilter: useCaseFilter ?? null,
  });

export const labListMatrixRuns = (personaId: string, limit?: number) =>
  invoke<LabMatrixRun[]>("lab_list_matrix_runs", { personaId, limit: limit ?? null });

export const labGetMatrixResults = (runId: string) =>
  invoke<LabMatrixResult[]>("lab_get_matrix_results", { runId });

export const labDeleteMatrixRun = (id: string) =>
  invoke<boolean>("lab_delete_matrix_run", { id });

export const labCancelMatrix = (id: string) =>
  invoke<void>("lab_cancel_matrix", { id });

export const labAcceptDraft = (runId: string) =>
  invoke<Persona>("lab_accept_matrix_draft", { runId });

// ============================================================================
// Eval — N prompt versions × M models evaluation matrix
// ============================================================================

export const labStartEval = (
  personaId: string,
  versionIds: string[],
  models: ModelTestConfig[],
  useCaseFilter?: string,
  testInput?: string,
) =>
  invoke<LabEvalRun>("lab_start_eval", {
    personaId,
    versionIds,
    models,
    useCaseFilter: useCaseFilter ?? null,
    testInput: testInput ?? null,
  });

export const labListEvalRuns = (personaId: string, limit?: number) =>
  invoke<LabEvalRun[]>("lab_list_eval_runs", { personaId, limit: limit ?? null });

export const labGetEvalResults = (runId: string) =>
  invoke<LabEvalResult[]>("lab_get_eval_results", { runId });

export const labDeleteEvalRun = (id: string) =>
  invoke<boolean>("lab_delete_eval_run", { id });

export const labCancelEval = (id: string) =>
  invoke<void>("lab_cancel_eval", { id });

// ============================================================================
// Versions (moved from observability)
// ============================================================================

export const labGetVersions = (personaId: string, limit?: number) =>
  invoke<PersonaPromptVersion[]>("lab_get_versions", { personaId, limit: limit ?? null });

export const labTagVersion = (id: string, tag: string) =>
  invoke<PersonaPromptVersion>("lab_tag_version", { id, tag });

export const labRollbackVersion = (versionId: string) =>
  invoke<PersonaPromptVersion>("lab_rollback_version", { versionId });

export const labGetErrorRate = (personaId: string, window?: number) =>
  invoke<number>("lab_get_error_rate", { personaId, window: window ?? null });
