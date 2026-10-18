import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaToolDefinition } from "@/lib/bindings/PersonaToolDefinition";
import type { CreateToolDefinitionInput } from "@/lib/bindings/CreateToolDefinitionInput";
import type { UpdateToolDefinitionInput } from "@/lib/bindings/UpdateToolDefinitionInput";
import type { PersonaTool } from "@/lib/bindings/PersonaTool";
import type { ToolUsageSummary } from "@/lib/bindings/ToolUsageSummary";
import type { ToolUsageOverTime } from "@/lib/bindings/ToolUsageOverTime";
import type { PersonaUsageSummary } from "@/lib/bindings/PersonaUsageSummary";
import type { ToolPerformanceSummary } from "@/lib/bindings/ToolPerformanceSummary";

// ============================================================================
// Tool Definitions & Assignments
// ============================================================================

export const listToolDefinitions = () =>
  invoke<PersonaToolDefinition[]>("list_tool_definitions");

export const getToolDefinition = (id: string) =>
  invoke<PersonaToolDefinition>("get_tool_definition", { id });

export const getToolDefinitionsByCategory = (category: string) =>
  invoke<PersonaToolDefinition[]>("get_tool_definitions_by_category", { category });

export const createToolDefinition = (input: CreateToolDefinitionInput) =>
  invoke<PersonaToolDefinition>("create_tool_definition", { input });

export const updateToolDefinition = (id: string, input: UpdateToolDefinitionInput) =>
  invoke<PersonaToolDefinition>("update_tool_definition", { id, input });

export const deleteToolDefinition = (id: string) =>
  invoke<boolean>("delete_tool_definition", { id });

export const assignTool = (
  personaId: string,
  toolId: string,
  toolConfig?: string,
) =>
  invoke<PersonaTool>("assign_tool", {
    personaId,
    toolId,
    toolConfig: toolConfig,
  });

export const unassignTool = (personaId: string, toolId: string) =>
  invoke<boolean>("unassign_tool", { personaId, toolId });

export const bulkAssignTools = (personaId: string, toolIds: string[]) =>
  invoke<number>("bulk_assign_tools", { personaId, toolIds });

export const bulkUnassignTools = (personaId: string, toolIds: string[]) =>
  invoke<number>("bulk_unassign_tools", { personaId, toolIds });

// -- Tool Usage Analytics --------------------------------------------------

export const getToolUsageSummary = (since: string, personaId?: string) =>
  invoke<ToolUsageSummary[]>("get_tool_usage_summary", { since, personaId: personaId });

export const getToolUsageOverTime = (since: string, personaId?: string) =>
  invoke<ToolUsageOverTime[]>("get_tool_usage_over_time", { since, personaId: personaId });

export const getToolUsageByPersona = (since: string) =>
  invoke<PersonaUsageSummary[]>("get_tool_usage_by_persona", { since });

export const getToolPerformanceSummary = (
  since: string,
  personaId?: string,
  limit?: number,
) =>
  invoke<ToolPerformanceSummary[]>("get_tool_performance_summary", {
    since,
    personaId,
    limit,
  });

// -- Direct Tool Invocation ----------------------------------------------

import type { ToolInvocationResult } from "@/lib/bindings/ToolInvocationResult";
export type { ToolInvocationResult } from "@/lib/bindings/ToolInvocationResult";

/**
 * IPC ceiling for `invoke_tool_direct`. The backend bounds a direct tool run
 * at 120 s (`DIRECT_TOOL_TIMEOUT`, `src-tauri/src/engine/tool_runner.rs`) and
 * answers a timeout with a structured, retryable `ToolInvocationResult`. The
 * wrapper's 90 s default rejected first, so a 90-120 s run surfaced a generic
 * IPC timeout and the real result was dropped. The margin covers rate-limit
 * wait and result serialisation.
 */
export const TOOL_DIRECT_IPC_TIMEOUT_MS = 135_000;

export const invokeToolDirect = (toolId: string, personaId: string, inputJson: string) =>
  invoke<ToolInvocationResult>(
    "invoke_tool_direct",
    { toolId, personaId, inputJson },
    { timeoutMs: TOOL_DIRECT_IPC_TIMEOUT_MS },
  );
