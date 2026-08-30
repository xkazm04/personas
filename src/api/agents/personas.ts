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
import type { PersonaChangeEntry } from "@/lib/bindings/PersonaChangeEntry";
import type { BulkDeleteOutcome } from "@/lib/bindings/BulkDeleteOutcome";
import type { DuplicatePersonaResult } from "@/lib/bindings/DuplicatePersonaResult";
export type { DuplicatePersonaResult } from "@/lib/bindings/DuplicatePersonaResult";
import type { ImportResult } from "@/lib/bindings/ImportResult";
export type { ImportResult } from "@/lib/bindings/ImportResult";
import type { GalleryPublishResult } from "@/lib/bindings/GalleryPublishResult";
import type { PresetPublishResult } from "@/lib/bindings/PresetPublishResult";
import type { ReferralStats } from "@/lib/bindings/ReferralStats";

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

/**
 * List personas for the roster (LEAN projection: list-view fields only — the
 * heavy editor-only blobs `system_prompt`, `structured_prompt`,
 * `last_test_report`, `notification_channels` and `parameters` come back blank;
 * they are re-hydrated per persona by `getPersonaDetail` when one is opened).
 *
 * `lifecycle` filters server-side to the given stages (e.g. `["active","draft"]`
 * or `["archived"]`); omit it to return every lifecycle stage.
 */
export const listPersonas = (lifecycle?: string[]) =>
  invoke<Persona[]>("list_personas", lifecycle && lifecycle.length ? { lifecycle } : undefined);

export const getPersona = (id: string) =>
  invoke<Persona>("get_persona", { id });

export const createPersona = (input: CreatePersonaInput) =>
  invoke<Persona>("create_persona", { input });

/**
 * Partial update. Build the payload with {@link buildUpdateInput} rather than
 * assembling it by hand — for the 13 `Option<Option<T>>` columns an explicit
 * `null` means "clear this column", so a hand-written payload that nulls the
 * fields it does not care about will erase them. See
 * {@link PERSONA_NULLABLE_FIELDS}.
 */
export const updatePersona = (id: string, input: PersonaUpdatePayload) =>
  invoke<Persona>("update_persona", { id, input });

/** Newest-first field-level change history for a persona (editor Settings tab). */
export const listPersonaChangeLog = (personaId: string, limit = 50) =>
  invoke<PersonaChangeEntry[]>("list_persona_change_log", { personaId, limit });

/**
 * Deep-duplicate a persona. The copy clones the persona's `persona_triggers`
 * and `persona_event_subscriptions` **disabled** (so it never double-fires);
 * automations, tools and credential links are reported (not cloned). The result
 * flattens the new persona with the copy summary counts.
 */
export const duplicatePersona = (sourceId: string) =>
  invoke<DuplicatePersonaResult>("duplicate_persona", { sourceId });

export const deletePersona = (id: string) =>
  invoke<DeletePersonaResult>("delete_persona", { id });

/** Archive a persona (lifecycle → `archived`); preserves all history. */
export const archivePersona = (id: string) =>
  invoke<Persona>("archive_persona", { id });

/** Restore an archived persona (lifecycle → `active`). */
export const restorePersona = (id: string) =>
  invoke<Persona>("restore_persona", { id });

/** Bulk-delete personas in one IPC; returns a per-id outcome report. */
export const bulkDeletePersonas = (ids: string[]) =>
  invoke<BulkDeleteOutcome[]>("bulk_delete_personas", { ids });

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

/** Opens a save dialog and writes the persona bundle to disk. Returns false if cancelled. */
export const exportPersona = (personaId: string) =>
  invoke<boolean>("export_persona", { personaId });

/** Opens a file picker and imports a persona bundle. Returns null if cancelled, or an
 *  ImportResult where `warnings` lists any sub-resource creation failures. */
export const importPersona = () =>
  invoke<ImportResult | null>("import_persona");

/** Publishes a persona to the public web gallery; returns its share slug + URL.
 *  `installId` is the caller's pseudonymous analytics install id (abuse
 *  attribution only). */
export const publishPersonaToGallery = (
  personaId: string,
  publisher?: string | null,
  installId?: string | null,
) =>
  invoke<GalleryPublishResult>("gallery_publish_persona", {
    personaId,
    publisher: publisher ?? null,
    installId: installId ?? null,
  });

/** Imports a persona from the public gallery by share slug (the receiving end
 *  of the share loop — driven by the `personas://import/<slug>` deep link). */
export const importPersonaFromGallery = (slug: string) =>
  invoke<ImportResult>("gallery_import_persona", { slug });

/** Publishes a team to the public community-preset catalog; returns its slug. */
export const publishTeamAsPreset = (
  teamId: string,
  publisher?: string | null,
  installId?: string | null,
) =>
  invoke<PresetPublishResult>("gallery_publish_preset", {
    teamId,
    publisher: publisher ?? null,
    installId: installId ?? null,
  });

/** Records that this install arrived via `referrerCode` (attribution). */
export const recordReferral = (referrerCode: string, installId: string) =>
  invoke<void>("record_referral", { referrerCode, installId });

/** How many installs `referrerCode` has been credited with. */
export const getReferralCount = (referrerCode: string) =>
  invoke<ReferralStats>("get_referral_count", { referrerCode });

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
  /** Lifecycle stage (`draft` | `active` | `archived`); omit to leave unchanged. */
  lifecycle?: string | null;
  /**
   * Serialized `PersonaCore` JSON — the persona's Character (living-agent
   * spine). Pass `null` to clear; omit to leave unchanged.
   */
  core_profile?: string | null;
  /** Change-log attribution — where this edit originated. Defaults to `editor`
   *  (the generic builder is the editor autosave path). Not a persisted column. */
  source?: 'editor' | 'header' | 'fanout' | 'other';
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
 * The 14 `Option<Option<T>>` columns on `UpdatePersonaInput` (see
 * `core/src/models/persona.rs`). Each carries
 * `#[serde(default, deserialize_with = "double_option")]`, which gives the key
 * THREE meanings on the wire — and the generated binding cannot express that,
 * because ts-rs flattens `Option<Option<T>>` to `T | null | null`:
 *
 *   key ABSENT     -> `None`          -> leave the column alone
 *   key = `null`   -> `Some(None)`    -> SET THE COLUMN TO NULL
 *   key = value    -> `Some(Some(v))` -> set it
 *
 * So for these fields "absent" and "null" are opposites, and sending `null`
 * where you meant "skip" erases data.
 */
export const PERSONA_NULLABLE_FIELDS = [
  'description', 'structured_prompt', 'icon', 'color', 'last_design_result',
  'last_test_report', 'model_profile', 'max_budget_usd', 'max_turns',
  'design_context', 'home_team_id', 'parameters', 'disabled_dims_json',
  'core_profile',
] as const;

type PersonaNullableField = (typeof PERSONA_NULLABLE_FIELDS)[number];

/**
 * Wire payload for `update_persona`, typed to match the Rust contract that the
 * flattened ts-rs binding loses:
 *
 * - plain `Option<T>` keys stay REQUIRED — for those, standard serde maps
 *   `null` to `None`, so `null` genuinely means "skip".
 * - the `Option<Option<T>>` keys above are OPTIONAL — omitting is the only way
 *   to say "skip", so the type must permit omission.
 */
export type PersonaUpdatePayload =
  Omit<UpdatePersonaInput, PersonaNullableField> &
  Partial<Pick<UpdatePersonaInput, PersonaNullableField>>;

/**
 * Convert a caller-friendly partial update into the payload the Tauri command
 * expects.
 *
 * - `Option<T>` fields: `null` = skip, value = set
 * - `Option<Option<T>>` fields: key OMITTED = skip, `null` = clear, value = set
 *
 * The omission is load-bearing, not a style choice. This builder used to write
 * `field: partial.field !== undefined ? partial.field : null` for every
 * nullable column, i.e. it emitted an explicit `null` for each field the caller
 * had not mentioned. That was correct before `double_option` existed, when
 * plain serde collapsed `null` and absent to the same `None`. Once
 * `double_option` was added to enable explicit clears, the meaning of every one
 * of those nulls silently inverted to `Some(None)`, and any caller passing a
 * genuinely partial update — `buildUpdateInput({ parameters })` from the
 * deep-fanout toggle, `buildUpdateInput({ disabled_dims_json })` from the
 * persona layout view — wiped the other twelve columns.
 */
export function buildUpdateInput(partial: PartialPersonaUpdate): PersonaUpdatePayload {
  const payload: PersonaUpdatePayload = {
    // Option<T> fields: null means "skip" on the Rust side.
    name: partial.name ?? null,
    system_prompt: partial.system_prompt ?? null,
    enabled: partial.enabled !== undefined ? partial.enabled : null,
    sensitive: partial.sensitive !== undefined ? partial.sensitive : null,
    headless: partial.headless !== undefined ? partial.headless : null,
    max_concurrent: partial.max_concurrent ?? null,
    timeout_ms: partial.timeout_ms ?? null,
    notification_channels: partial.notification_channels ?? null,
    gateway_exposure: partial.gateway_exposure !== undefined ? partial.gateway_exposure : null,
    cli_awareness_enabled:
      partial.cli_awareness_enabled !== undefined ? partial.cli_awareness_enabled : null,
    // lifecycle is normally driven by the archive/restore/promote commands, not
    // this generic builder; passing null = "leave unchanged".
    lifecycle: partial.lifecycle ?? null,
    // Change-log attribution — the generic builder serves the editor autosave
    // path; header/model-switch ops override this explicitly.
    source: partial.source ?? 'editor',
  };

  // Option<Option<T>> fields: assign ONLY when the caller named the field, so
  // an unmentioned column is absent from the JSON rather than null.
  // `last_test_report` is deliberately never listed here — it is owned by
  // build_sessions.rs (the Phase 2 tool_tests surface) and this builder must
  // leave it untouched, which now means omitting it rather than nulling it.
  for (const key of PERSONA_NULLABLE_FIELDS) {
    if (key === 'last_test_report') continue;
    const value = (partial as Record<string, unknown>)[key];
    if (value !== undefined) {
      (payload as Record<string, unknown>)[key] = value;
    }
  }

  return payload;
}
