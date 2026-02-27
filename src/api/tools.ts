import { invoke } from "@tauri-apps/api/core";

import type { PersonaToolDefinition } from "@/lib/bindings/PersonaToolDefinition";
import type { CreateToolDefinitionInput } from "@/lib/bindings/CreateToolDefinitionInput";
import type { UpdateToolDefinitionInput } from "@/lib/bindings/UpdateToolDefinitionInput";
import type { PersonaTool } from "@/lib/bindings/PersonaTool";
import type { ToolUsageSummary, ToolUsageOverTime, PersonaUsageSummary } from "@/lib/types/types";

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
    toolConfig: toolConfig ?? null,
  });

export const unassignTool = (personaId: string, toolId: string) =>
  invoke<boolean>("unassign_tool", { personaId, toolId });

export const bulkAssignTools = (personaId: string, toolIds: string[]) =>
  invoke<number>("bulk_assign_tools", { personaId, toolIds });

export const bulkUnassignTools = (personaId: string, toolIds: string[]) =>
  invoke<number>("bulk_unassign_tools", { personaId, toolIds });

// ── Tool Usage Analytics ──────────────────────────────────────────────────

export const getToolUsageSummary = (since: string, personaId?: string) =>
  invoke<ToolUsageSummary[]>("get_tool_usage_summary", { since, personaId: personaId ?? null });

export const getToolUsageOverTime = (since: string, personaId?: string) =>
  invoke<ToolUsageOverTime[]>("get_tool_usage_over_time", { since, personaId: personaId ?? null });

export const getToolUsageByPersona = (since: string) =>
  invoke<PersonaUsageSummary[]>("get_tool_usage_by_persona", { since });
