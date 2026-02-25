import { invoke } from "@tauri-apps/api/core";

import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";

// ============================================================================
// Executions
// ============================================================================

export const listExecutions = (personaId: string, limit?: number) =>
  invoke<PersonaExecution[]>("list_executions", {
    personaId,
    limit: limit ?? null,
  });

export const getExecution = (id: string) =>
  invoke<PersonaExecution>("get_execution", { id });

export const cancelExecution = (id: string) =>
  invoke<void>("cancel_execution", { id });

export const executePersona = (
  personaId: string,
  triggerId?: string,
  inputData?: string,
  useCaseId?: string,
) =>
  invoke<PersonaExecution>("execute_persona", {
    personaId,
    triggerId: triggerId ?? null,
    inputData: inputData ?? null,
    useCaseId: useCaseId ?? null,
  });

export const listExecutionsForUseCase = (
  personaId: string,
  useCaseId: string,
  limit?: number,
) =>
  invoke<PersonaExecution[]>("list_executions_for_use_case", {
    personaId,
    useCaseId,
    limit: limit ?? null,
  });

export const getExecutionLog = (id: string) =>
  invoke<string | null>("get_execution_log", { id });
