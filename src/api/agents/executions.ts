import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaExecution } from "@/lib/bindings/PersonaExecution";
import type { ExecutionListItem } from "@/lib/bindings/ExecutionListItem";
import type { GlobalExecutionRow } from "@/lib/bindings/GlobalExecutionRow";
import type { ExecutionCounts } from "@/lib/bindings/ExecutionCounts";
import type { ExecutionSearchResult } from "@/lib/bindings/ExecutionSearchResult";
import type { Continuation } from "@/lib/bindings/Continuation";
import type { ExecutionTrace } from "@/lib/bindings/ExecutionTrace";
import type { DreamReplaySession } from "@/lib/bindings/DreamReplaySession";
import type { CircuitBreakerStatus } from "@/lib/bindings/CircuitBreakerStatus";
import type { DryRunReport } from "@/lib/bindings/DryRunReport";
import type { ExecutionPreview } from "@/lib/bindings/ExecutionPreview";

// ============================================================================
// Executions
// ============================================================================

export const listExecutions = (personaId: string, limit?: number) =>
  invoke<PersonaExecution[]>("list_executions", {
    personaId,
    limit: limit,
  });

export const listExecutionsSummary = (personaId: string, limit?: number) =>
  invoke<ExecutionListItem[]>("list_executions_summary", {
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

export const searchExecutions = (query: string, limit?: number, personaId?: string) =>
  invoke<ExecutionSearchResult[]>("search_executions", { query, limit, personaId });

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

export const preparePersonaExecution = (personaId: string) =>
  invoke<string>("prepare_persona_execution", { personaId });

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

// Re-export the generated binding (single source of truth) under the api/ path
// so existing `import { ExecutionPreview } from '@/api/agents/executions'`
// consumers keep working. The hand-rolled duplicate previously drifted: it typed
// the token counts as `number` where the Rust u64 generates `bigint`.
export type { ExecutionPreview };

export const previewExecution = (personaId: string, inputData?: string, useCaseId?: string) =>
  invoke<ExecutionPreview>("preview_execution", { personaId, inputData, useCaseId });

export const dryRunPersona = (personaId: string, inputData?: string, useCaseId?: string) =>
  invoke<DryRunReport>("dry_run_persona", { personaId, inputData, useCaseId });
