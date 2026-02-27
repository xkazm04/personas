import { invoke } from "@tauri-apps/api/core";

import type { Persona } from "@/lib/bindings/Persona";
import type { PersonaSummary } from "@/lib/bindings/PersonaSummary";
import type { CreatePersonaInput } from "@/lib/bindings/CreatePersonaInput";
import type { UpdatePersonaInput } from "@/lib/bindings/UpdatePersonaInput";

// ============================================================================
// Personas
// ============================================================================

export const listPersonas = () =>
  invoke<Persona[]>("list_personas");

export const getPersona = (id: string) =>
  invoke<Persona>("get_persona", { id });

export const createPersona = (input: CreatePersonaInput) =>
  invoke<Persona>("create_persona", { input });

export const updatePersona = (id: string, input: UpdatePersonaInput) =>
  invoke<Persona>("update_persona", { id, input });

export const deletePersona = (id: string) =>
  invoke<boolean>("delete_persona", { id });

export const getPersonaSummaries = () =>
  invoke<PersonaSummary[]>("get_persona_summaries");

// ============================================================================
// Import / Export
// ============================================================================

/** Mirrors the Rust ImportResult struct from import_export.rs */
export interface ImportResult {
  persona_id: string;
  /** Non-fatal errors from sub-resource creation (triggers, subscriptions, memories). */
  warnings: string[];
}

/** Opens a save dialog and writes the persona bundle to disk. Returns false if cancelled. */
export const exportPersona = (personaId: string) =>
  invoke<boolean>("export_persona", { personaId });

/** Opens a file picker and imports a persona bundle. Returns null if cancelled, or an
 *  ImportResult where `warnings` lists any sub-resource creation failures. */
export const importPersona = () =>
  invoke<ImportResult | null>("import_persona");

// ============================================================================
// Typed partial update helper
// ============================================================================

/** Caller-friendly partial type — only include the fields you want to change. */
export interface PartialPersonaUpdate {
  name?: string;
  description?: string | null;
  system_prompt?: string;
  structured_prompt?: string | null;
  icon?: string | null;
  color?: string | null;
  enabled?: boolean;
  max_concurrent?: number;
  timeout_ms?: number;
  notification_channels?: string;
  last_design_result?: string | null;
  model_profile?: string | null;
  max_budget_usd?: number | null;
  max_turns?: number | null;
  design_context?: string | null;
  group_id?: string | null;
}

// ============================================================================
// Named persona operations (semantic intent layer)
// ============================================================================

/** Switch the model/provider configuration. */
export interface SwitchModelOp {
  kind: 'SwitchModel';
  model_profile: string | null;
  max_budget_usd?: number | null;
  max_turns?: number | null;
}

/** Move persona to a different group. */
export interface MoveToGroupOp {
  kind: 'MoveToGroup';
  group_id: string | null;
}

/** Toggle enabled/disabled. */
export interface ToggleEnabledOp {
  kind: 'ToggleEnabled';
  enabled: boolean;
}

/** Save the structured prompt and/or system prompt. */
export interface UpdatePromptOp {
  kind: 'UpdatePrompt';
  structured_prompt?: string | null;
  system_prompt?: string;
}

/** Update persona metadata (name, description, icon, color, concurrency, timeout). */
export interface UpdateSettingsOp {
  kind: 'UpdateSettings';
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  enabled?: boolean;
  max_concurrent?: number;
  timeout_ms?: number;
}

/** Update design context (use-cases, design files, connector links). */
export interface UpdateDesignContextOp {
  kind: 'UpdateDesignContext';
  design_context: string | null;
}

/** Apply an AI design analysis result (multi-field update). */
export interface ApplyDesignResultOp {
  kind: 'ApplyDesignResult';
  updates: PartialPersonaUpdate;
}

/** Update budget limit. */
export interface UpdateBudgetOp {
  kind: 'UpdateBudget';
  max_budget_usd: number | null;
}

/** Update notification channel configuration. */
export interface UpdateNotificationsOp {
  kind: 'UpdateNotifications';
  notification_channels: string;
}

/**
 * Discriminated union of all persona mutation intents.
 * Each variant maps to specific fields in PartialPersonaUpdate but preserves
 * the semantic action for analytics, undo, and permission checks.
 */
export type PersonaOperation =
  | SwitchModelOp
  | MoveToGroupOp
  | ToggleEnabledOp
  | UpdatePromptOp
  | UpdateSettingsOp
  | UpdateDesignContextOp
  | ApplyDesignResultOp
  | UpdateBudgetOp
  | UpdateNotificationsOp;

/** Map a named operation to its underlying PartialPersonaUpdate. */
export function operationToPartial(op: PersonaOperation): PartialPersonaUpdate {
  switch (op.kind) {
    case 'SwitchModel':
      return { model_profile: op.model_profile, max_budget_usd: op.max_budget_usd, max_turns: op.max_turns };
    case 'MoveToGroup':
      return { group_id: op.group_id };
    case 'ToggleEnabled':
      return { enabled: op.enabled };
    case 'UpdatePrompt':
      return { structured_prompt: op.structured_prompt, system_prompt: op.system_prompt };
    case 'UpdateSettings':
      return {
        name: op.name, description: op.description, icon: op.icon, color: op.color,
        enabled: op.enabled, max_concurrent: op.max_concurrent, timeout_ms: op.timeout_ms,
      };
    case 'UpdateDesignContext':
      return { design_context: op.design_context };
    case 'ApplyDesignResult':
      return op.updates;
    case 'UpdateBudget':
      return { max_budget_usd: op.max_budget_usd };
    case 'UpdateNotifications':
      return { notification_channels: op.notification_channels };
  }
}

/**
 * Convert a caller-friendly partial update into the full UpdatePersonaInput
 * expected by the Tauri command.
 *
 * - Option<T> fields: `null` = skip, value = set
 * - Option<Option<T>> fields: key absent = skip, `null` = clear, value = set
 */
export function buildUpdateInput(partial: PartialPersonaUpdate): UpdatePersonaInput {
  return {
    // Option<T> fields: null means "skip" on the Rust side
    name: partial.name ?? null,
    system_prompt: partial.system_prompt ?? null,
    enabled: partial.enabled !== undefined ? partial.enabled : null,
    max_concurrent: partial.max_concurrent ?? null,
    timeout_ms: partial.timeout_ms ?? null,
    notification_channels: partial.notification_channels ?? null,
    // Option<Option<T>> fields: only include when explicitly provided
    description: partial.description !== undefined ? partial.description : null,
    structured_prompt: partial.structured_prompt !== undefined ? partial.structured_prompt : null,
    icon: partial.icon !== undefined ? partial.icon : null,
    color: partial.color !== undefined ? partial.color : null,
    last_design_result: partial.last_design_result !== undefined ? partial.last_design_result : null,
    model_profile: partial.model_profile !== undefined ? partial.model_profile : null,
    max_budget_usd: partial.max_budget_usd !== undefined ? partial.max_budget_usd : null,
    max_turns: partial.max_turns !== undefined ? partial.max_turns : null,
    design_context: partial.design_context !== undefined ? partial.design_context : null,
    group_id: partial.group_id !== undefined ? partial.group_id : null,
  };
}
