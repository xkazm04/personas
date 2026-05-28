import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { Persona } from "@/lib/bindings/Persona";
import type { PersonaSummary } from "@/lib/bindings/PersonaSummary";
import type { PersonaToolDefinition } from "@/lib/bindings/PersonaToolDefinition";
import type { PersonaTrigger } from "@/lib/bindings/PersonaTrigger";
import type { PersonaEventSubscription } from "@/lib/bindings/PersonaEventSubscription";
import type { PersonaAutomation } from "@/lib/bindings/PersonaAutomation";
import type { CreatePersonaInput } from "@/lib/bindings/CreatePersonaInput";
import type { DeletePersonaResult } from "@/lib/bindings/DeletePersonaResult";
import type { EffectiveModelConfig } from "@/lib/bindings/EffectiveModelConfig";
import type { UpdatePersonaInput } from "@/lib/bindings/UpdatePersonaInput";

/** Batched persona detail returned by the single `get_persona_detail` IPC command. */
export interface PersonaDetailResponse extends Persona {
  tools: PersonaToolDefinition[];
  triggers: PersonaTrigger[];
  subscriptions: PersonaEventSubscription[];
  automations: PersonaAutomation[];
  /** Non-empty when one or more sub-resource queries failed to load. */
  warnings?: string[];
}

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

export const duplicatePersona = (sourceId: string) =>
  invoke<Persona>("duplicate_persona", { sourceId });

export const deletePersona = (id: string) =>
  invoke<DeletePersonaResult>("delete_persona", { id });

/** Star/unstar a persona (its membership in the Director's coaching scope). */
export const setPersonaStarred = (id: string, starred: boolean) =>
  invoke<boolean>("set_persona_starred", { id, starred });

export interface BlastRadiusItem {
  category: string;
  description: string;
}

export const getPersonaBlastRadius = (id: string) =>
  invoke<BlastRadiusItem[]>("persona_blast_radius", { id });

export const getPersonaSummaries = () =>
  invoke<PersonaSummary[]>("get_persona_summaries");

/** Single IPC call that returns the persona with all sub-resources. */
export const getPersonaDetail = (id: string) =>
  invoke<PersonaDetailResponse>("get_persona_detail", { id });

/**
 * Returns persona IDs that have at least one tool whose `requires_credential_type`
 * matches `connectorName`. Used by the Agents sidebar to surface personas linked
 * to a specific connector (e.g. `"codebase"`) without fetching every persona's
 * full detail.
 */
export const listPersonasUsingConnector = (connectorName: string) =>
  invoke<string[]>("list_personas_using_connector", { connectorName });

/** Resolve the effective model config for a persona (global -> workspace -> agent cascade). */
export const resolveEffectiveConfig = (personaId: string) =>
  invoke<EffectiveModelConfig>("resolve_effective_config", { personaId });

/**
 * Resolve effective model config for many personas in a single IPC call.
 *
 * The backend fetches all personas, all groups, and the global-tier
 * settings exactly once, so this is O(1) IPC roundtrips regardless of how
 * many personas are requested — replacing the per-persona fan-out that
 * cost ~10 s on the Settings → Config panel with ~142 personas. IDs that
 * don't match a persona are omitted; callers should key the result by
 * `personaId`.
 */
export const resolveEffectiveConfigBulk = (personaIds: string[]) =>
  invoke<EffectiveModelConfig[]>("resolve_effective_config_bulk", { personaIds });

// ============================================================================
// Import / Export
// ============================================================================

import type { ImportResult } from "@/lib/bindings/ImportResult";
export type { ImportResult } from "@/lib/bindings/ImportResult";

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

/** Caller-friendly partial type -- only include the fields you want to change. */
export interface PartialPersonaUpdate {
  name?: string;
  description?: string | null;
  system_prompt?: string;
  structured_prompt?: string | null;
  icon?: string | null;
  color?: string | null;
  enabled?: boolean;
  sensitive?: boolean;
  headless?: boolean;
  max_concurrent?: number;
  timeout_ms?: number;
  notification_channels?: string;
  last_design_result?: string | null;
  model_profile?: string | null;
  max_budget_usd?: number | null;
  max_turns?: number | null;
  design_context?: string | null;
  home_team_id?: string | null;
  parameters?: string | null;
  /**
   * Visibility to the external management HTTP API ("A2A gateway").
   * Default is `local_only` so admins must opt personas in.
   */
  gateway_exposure?: import('@/lib/bindings/PersonaGatewayExposure').PersonaGatewayExposure;
  /**
   * Phase 5 v1 (Athena CLI session awareness): per-persona gate. Both this
   * AND the global `cli_session_awareness_enabled` setting must be true
   * before the runner injects a "Claude CLI session" block into the prompt.
   */
  cli_awareness_enabled?: boolean;
  /**
   * Per-capability dim disables — JSON string `{ [use_case_id]: GlyphDimension[] }`.
   * Set by the View-mode SigilEditModal when the user toggles a petal off.
   * Pass `null` to clear; omit to leave unchanged. The runtime executor reads
   * this and skips actions for a capability whose dim is in its set.
   */
  disabled_dims_json?: string | null;
  /**
   * Per-persona Langfuse trace export gate. When `false`, the runner skips
   * shipping this persona's traces to Langfuse even when the plugin is
   * connected. Defaults to `true` on insert.
   */
  langfuse_export_enabled?: boolean;
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

/** Set the persona's home team (workspace). `null` clears it. */
export interface SetHomeTeamOp {
  kind: 'SetHomeTeam';
  home_team_id: string | null;
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
  sensitive?: boolean;
  max_concurrent?: number;
  timeout_ms?: number;
  cli_awareness_enabled?: boolean;
  langfuse_export_enabled?: boolean;
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

/** Update free parameters (lightweight, no rebuild). */
export interface UpdateParametersOp {
  kind: 'UpdateParameters';
  parameters: string | null;
}

/**
 * Discriminated union of all persona mutation intents.
 * Each variant maps to specific fields in PartialPersonaUpdate but preserves
 * the semantic action for analytics, undo, and permission checks.
 */
export type PersonaOperation =
  | SwitchModelOp
  | SetHomeTeamOp
  | ToggleEnabledOp
  | UpdatePromptOp
  | UpdateSettingsOp
  | UpdateDesignContextOp
  | ApplyDesignResultOp
  | UpdateBudgetOp
  | UpdateNotificationsOp
  | UpdateParametersOp;

/** Map a named operation to its underlying PartialPersonaUpdate. */
export function operationToPartial(op: PersonaOperation): PartialPersonaUpdate {
  switch (op.kind) {
    case 'SwitchModel':
      return { model_profile: op.model_profile, max_budget_usd: op.max_budget_usd, max_turns: op.max_turns };
    case 'SetHomeTeam':
      return { home_team_id: op.home_team_id };
    case 'ToggleEnabled':
      return { enabled: op.enabled };
    case 'UpdatePrompt':
      return { structured_prompt: op.structured_prompt, system_prompt: op.system_prompt };
    case 'UpdateSettings':
      return {
        name: op.name, description: op.description, icon: op.icon, color: op.color,
        enabled: op.enabled, sensitive: op.sensitive, max_concurrent: op.max_concurrent, timeout_ms: op.timeout_ms,
        cli_awareness_enabled: op.cli_awareness_enabled,
        langfuse_export_enabled: op.langfuse_export_enabled,
      };
    case 'UpdateDesignContext':
      return { design_context: op.design_context };
    case 'ApplyDesignResult':
      return op.updates;
    case 'UpdateBudget':
      return { max_budget_usd: op.max_budget_usd };
    case 'UpdateNotifications':
      return { notification_channels: op.notification_channels };
    case 'UpdateParameters':
      return { parameters: op.parameters };
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
    sensitive: partial.sensitive !== undefined ? partial.sensitive : null,
    headless: partial.headless !== undefined ? partial.headless : null,
    max_concurrent: partial.max_concurrent ?? null,
    timeout_ms: partial.timeout_ms ?? null,
    notification_channels: partial.notification_channels ?? null,
    // Option<Option<T>> fields: only include when explicitly provided
    description: partial.description !== undefined ? partial.description : null,
    structured_prompt: partial.structured_prompt !== undefined ? partial.structured_prompt : null,
    icon: partial.icon !== undefined ? partial.icon : null,
    color: partial.color !== undefined ? partial.color : null,
    last_design_result: partial.last_design_result !== undefined ? partial.last_design_result : null,
    // last_test_report is owned by build_sessions.rs (Phase 2 tool_tests surface)
    // — never set from the frontend builder, so always pass null here.
    last_test_report: null,
    model_profile: partial.model_profile !== undefined ? partial.model_profile : null,
    max_budget_usd: partial.max_budget_usd !== undefined ? partial.max_budget_usd : null,
    max_turns: partial.max_turns !== undefined ? partial.max_turns : null,
    design_context: partial.design_context !== undefined ? partial.design_context : null,
    home_team_id: partial.home_team_id !== undefined ? partial.home_team_id : null,
    parameters: partial.parameters !== undefined ? partial.parameters : null,
    gateway_exposure: partial.gateway_exposure !== undefined ? partial.gateway_exposure : null,
    cli_awareness_enabled: partial.cli_awareness_enabled !== undefined ? partial.cli_awareness_enabled : null,
    disabled_dims_json: partial.disabled_dims_json !== undefined ? partial.disabled_dims_json : null,
    langfuse_export_enabled: partial.langfuse_export_enabled !== undefined ? partial.langfuse_export_enabled : null,
  };
}
