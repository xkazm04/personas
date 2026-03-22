import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import type { GlobalExecutionRow } from "@/lib/bindings/GlobalExecutionRow";
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

export const listAllExecutions = (limit?: number, status?: string) =>
  invoke<GlobalExecutionRow[]>("list_all_executions", {
    limit: limit,
    status: status,
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
    triggerId: triggerId,
    inputData: inputData,
    useCaseId: useCaseId,
    continuation: continuation,
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

export const getExecutionLogLines = (id: string, callerPersonaId: string) =>
  invoke<string[]>("get_execution_log_lines", { id, callerPersonaId });

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
