import { invoke } from "@tauri-apps/api/core";

import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import type { Continuation } from "@/lib/bindings/Continuation";
import type { ExecutionTrace } from "@/lib/bindings/ExecutionTrace";

// ============================================================================
// Executions
// ============================================================================

export const listExecutions = (personaId: string, limit?: number) =>
  invoke<PersonaExecution[]>("list_executions", {
    personaId,
    limit: limit ?? null,
  });

export const getExecution = (id: string, callerPersonaId: string) =>
  invoke<PersonaExecution>("get_execution", { id, callerPersonaId });

export const cancelExecution = (id: string, callerPersonaId: string) =>
  invoke<void>("cancel_execution", { id, callerPersonaId });

export const executePersona = (
  personaId: string,
  triggerId?: string,
  inputData?: string,
  useCaseId?: string,
  continuation?: Continuation,
) =>
  invoke<PersonaExecution>("execute_persona", {
    personaId,
    triggerId: triggerId ?? null,
    inputData: inputData ?? null,
    useCaseId: useCaseId ?? null,
    continuation: continuation ?? null,
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

export const getExecutionLog = (id: string, callerPersonaId: string) =>
  invoke<string | null>("get_execution_log", { id, callerPersonaId });

// ============================================================================
// Traces
// ============================================================================

export const getExecutionTrace = (executionId: string, callerPersonaId: string) =>
  invoke<ExecutionTrace | null>("get_execution_trace", { executionId, callerPersonaId });

export const getChainTrace = (chainTraceId: string, callerPersonaId: string) =>
  invoke<ExecutionTrace[]>("get_chain_trace", { chainTraceId, callerPersonaId });
