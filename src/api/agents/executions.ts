import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import type { GlobalExecutionRow } from "@/lib/bindings/GlobalExecutionRow";
import type { ExecutionCounts } from "@/lib/bindings/ExecutionCounts";
import type { Continuation } from "@/lib/bindings/Continuation";
import type { ExecutionTrace } from "@/lib/bindings/ExecutionTrace";
import type { DreamReplaySession } from "@/lib/bindings/DreamReplaySession";
import type { CircuitBreakerStatus } from "@/lib/bindings/CircuitBreakerStatus";

// ============================================================================
// Executions
// ============================================================================

export const listExecutions = (personaId: string, limit?: number) =>
  invoke<PersonaExecution[]>("list_executions", {
    personaId,
    limit: limit,
  });

export const listAllExecutions = (limit?: number, status?: string, personaId?: string) =>
  invoke<GlobalExecutionRow[]>("list_all_executions", {
    limit: limit,
    status: status,
    personaId: personaId,
  });

export const countExecutions = (personaId?: string) =>
  invoke<ExecutionCounts>("count_executions", { personaId });

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
  idempotencyKey?: string,
) =>
  invoke<PersonaExecution>("execute_persona", {
    personaId,
    triggerId: triggerId,
    inputData: inputData,
    useCaseId: useCaseId,
    continuation: continuation,
    idempotencyKey: idempotencyKey,
  }, idempotencyKey ? { idempotencyKey } : undefined);

export const listExecutionsByTrigger = (triggerId: string, limit?: number) =>
  invoke<PersonaExecution[]>("list_executions_by_trigger", {
    triggerId,
    limit: limit,
  });

export const listExecutionsForUseCase = (
  personaId: string,
  useCaseId: string,
  limit?: number,
) =>
  invoke<PersonaExecution[]>("list_executions_for_use_case", {
    personaId,
    useCaseId,
    limit: limit,
  });

export const getExecutionLog = (id: string, callerPersonaId: string) =>
  invoke<string | null>("get_execution_log", { id, callerPersonaId });

export const getExecutionLogLines = (
  id: string,
  callerPersonaId: string,
  offset?: number,
  limit?: number,
) =>
  invoke<string[]>("get_execution_log_lines", { id, callerPersonaId, offset, limit });

// ============================================================================
// Traces
// ============================================================================

export const getExecutionTrace = (executionId: string, callerPersonaId: string) =>
  invoke<ExecutionTrace | null>("get_execution_trace", { executionId, callerPersonaId });

export const getChainTrace = (chainTraceId: string, callerPersonaId: string) =>
  invoke<ExecutionTrace[]>("get_chain_trace", { chainTraceId, callerPersonaId });

// ============================================================================
// Dream Replay
// ============================================================================

export const getDreamReplay = (executionId: string, callerPersonaId: string) =>
  invoke<DreamReplaySession | null>("get_dream_replay", { executionId, callerPersonaId });

// ============================================================================
// Circuit Breaker
// ============================================================================

export const getCircuitBreakerStatus = () =>
  invoke<CircuitBreakerStatus>("get_circuit_breaker_status");

// ============================================================================
// Execution Preview
// ============================================================================

export interface ExecutionPreview {
  prompt_preview: string;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_input_cost: number;
  estimated_output_cost: number;
  estimated_total_cost: number;
  model: string;
  memory_count: number;
  tool_count: number;
  monthly_spend: number;
  budget_limit: number;
}

export const previewExecution = (personaId: string, inputData?: string, useCaseId?: string) =>
  invoke<ExecutionPreview>("preview_execution", { personaId, inputData, useCaseId });
