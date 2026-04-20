import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { Persona } from "@/lib/bindings/Persona";

// ============================================================================
// N8n Transform -- types
// ============================================================================

export interface N8nTriggerDraft {
  trigger_type: string;
  config?: Record<string, unknown> | null;
  description?: string | null;
  use_case_id?: string | null;
}

export interface N8nToolDraft {
  name: string;
  category: string;
  description: string;
  requires_credential_type?: string | null;
  input_schema?: Record<string, unknown> | null;
  implementation_guide?: string | null;
}

export interface N8nConnectorRef {
  name: string;
  n8n_credential_type: string;
  has_credential: boolean;
}

export interface N8nPersonaDraft {
  name: string | null;
  description: string | null;
  system_prompt: string;
  structured_prompt: Record<string, unknown> | null;
  icon: string | null;
  color: string | null;
  model_profile: string | null;
  max_budget_usd: number | null;
  max_turns: number | null;
  design_context: string | null;
  notification_channels?: string | null;
  // Entity fields -- populated by connector-aware transform
  triggers?: N8nTriggerDraft[] | null;
  tools?: N8nToolDraft[] | null;
  required_connectors?: N8nConnectorRef[] | null;
}

export interface N8nTransformResult {
  draft: N8nPersonaDraft;
}

export interface N8nTransformStartResult {
  transform_id: string;
}

export interface TransformQuestionResponse {
  id: string;
  category?: string;
  question: string;
  type: 'select' | 'text' | 'textarea' | 'boolean' | 'devtools_project' | 'directory_picker' | 'source_definition';
  options?: string[];
  default?: string;
  context?: string;
  allow_custom?: boolean;
  /** Phase C2 — scope for grouped questionnaire UI.
   *  Populated by the backend when the template declares it; otherwise
   *  inferred at render time from `use_case_ids` / connector hints. */
  scope?: 'persona' | 'capability' | 'connector';
  /** Phase C2 — capability id when `scope === 'capability'`. Must match a
   *  `use_cases[].id` in the template's design_context. */
  use_case_id?: string;
  /** Phase C2 — use case ids the question applies to. Single-entry arrays
   *  also count as a capability scope hint when `scope` is absent. */
  use_case_ids?: string[];
  /** Phase C2 — connector names the question configures. Triggers connector
   *  scope when present and no explicit scope is set. */
  connector_names?: string[];
  /** Credential category to match against the vault (e.g. "cloud", "ai"). */
  vault_category?: string;
  /** Parallel array mapping each `options` entry to a credential service_type. null = no mapping. */
  option_service_types?: (string | null)[];
  /**
   * When set, the adoption questionnaire loads the option list dynamically
   * from a connector API (or, for `codebases`, from the local dev_projects
   * table) using the credential the user has connected. Turns hard-to-guess
   * identifiers (Sentry project slugs, codebase names, ...) into a real
   * pickable list at adoption time.
   *
   * - `service_type`: which connector to query (e.g. `"sentry"`, `"codebases"`)
   * - `operation`: a registry key the Rust backend resolves (e.g. `"list_projects"`)
   * - `depends_on`: parent question id — discovery is deferred until the
   *   parent is answered and the answer is passed as `{{param.<depends_on>}}`
   * - `multi`: allow multi-select (stored as comma-separated CSV in the
   *   answers map to stay compatible with `Record<string,string>`)
   * - `include_all_option`: prepend a synthetic "all" pill that clears the
   *   multi-selection (useful for "monitor all projects" style defaults)
   */
  dynamic_source?: {
    service_type: string;
    operation: string;
    depends_on?: string;
    multi?: boolean;
    include_all_option?: boolean;
    /**
     * When `"vault"`, the option list is sourced directly from the user's
     * installed credentials — no IPC call, no per-connector discovery. The
     * `service_type` is interpreted as a connector category tag (see
     * `connectorCategoryTags` in lib/credentials/builtinConnectors), and each
     * installed+healthy credential whose connector claims that tag becomes
     * one option (value = credential.service_type, label = credential.name).
     * Use for "which provider in category X?" picker questions where static
     * options would otherwise hardcode a provider list that drifts from the
     * vault catalog over time.
     */
    source?: 'vault';
  };
}

export interface N8nTransformSnapshot {
  transform_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  draft: N8nPersonaDraft | null;
  questions: TransformQuestionResponse[] | null;
  /** Streaming sections accumulated during section-by-section transform. */
  sections: StreamingSection[];
}

// ============================================================================
// Streaming Section Types
// ============================================================================

export type SectionKind =
  | 'identity'
  | 'prompt'
  | 'tool'
  | 'trigger'
  | 'connector'
  | 'design_context';

export interface SectionValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface StreamingSection {
  kind: SectionKind;
  index: number;
  label: string;
  data: Record<string, unknown>;
  validation: SectionValidation;
}

// ============================================================================
// N8n Transform -- commands
// ============================================================================

export const startN8nTransformBackground = (
  transformId: string,
  workflowName: string,
  workflowJson: string,
  parserResultJson: string,
  adjustmentRequest?: string | null,
  previousDraftJson?: string | null,
  connectorsJson?: string | null,
  credentialsJson?: string | null,
  userAnswersJson?: string | null,
  sessionId?: string | null,
) =>
  invoke<N8nTransformStartResult>("start_n8n_transform_background", {
    transformId,
    workflowName,
    workflowJson,
    parserResultJson,
    adjustmentRequest: adjustmentRequest,
    previousDraftJson: previousDraftJson,
    connectorsJson: connectorsJson,
    credentialsJson: credentialsJson,
    userAnswersJson: userAnswersJson,
    sessionId: sessionId,
  });

export const getN8nTransformSnapshot = (transformId: string) =>
  invoke<N8nTransformSnapshot>("get_n8n_transform_snapshot", { transformId });

export const clearN8nTransformSnapshot = (transformId: string) =>
  invoke<void>("clear_n8n_transform_snapshot", { transformId });

export const cancelN8nTransform = (transformId: string) =>
  invoke<void>("cancel_n8n_transform", { transformId });

export const confirmN8nPersonaDraft = (draftJson: string, sessionId?: string | null) =>
  invoke<{ persona: Persona }>("confirm_n8n_persona_draft", { draftJson, sessionId: sessionId });

export const continueN8nTransform = (
  transformId: string,
  userAnswersJson: string,
  sessionId?: string | null,
) =>
  invoke<{ transform_id: string }>("continue_n8n_transform", {
    transformId,
    userAnswersJson,
    sessionId: sessionId,
  });

// ============================================================================
// N8n Transform Sessions (persisted wizard state)
// ============================================================================

export type { N8nTransformSession } from '@/lib/bindings/N8nTransformSession';
export type { N8nSessionResponse } from '@/lib/bindings/N8nSessionResponse';

export const createN8nSession = (
  workflowName: string,
  rawWorkflowJson: string,
  step: string,
  status: import('@/lib/bindings/SessionStatus').SessionStatus,
) =>
  invoke<import('@/lib/bindings/N8nSessionResponse').N8nSessionResponse>(
    "create_n8n_session",
    { workflowName, rawWorkflowJson, step, status },
  );

export const getN8nSession = (id: string) =>
  invoke<import('@/lib/bindings/N8nSessionResponse').N8nSessionResponse>(
    "get_n8n_session",
    { id },
  );

export const listN8nSessions = () =>
  invoke<import('@/lib/bindings/N8nSessionResponse').N8nSessionResponse[]>(
    "list_n8n_sessions",
  );

export const listN8nSessionSummaries = () =>
  invoke<import('@/lib/bindings/N8nSessionSummary').N8nSessionSummary[]>(
    "list_n8n_session_summaries",
  );

export const updateN8nSession = (
  id: string,
  updates: {
    workflowName?: string;
    status?: import('@/lib/bindings/SessionStatus').SessionStatus;
    parserResult?: string | null;
    draftJson?: string | null;
    userAnswers?: string | null;
    step?: string;
    error?: string | null;
    personaId?: string | null;
    transformId?: string | null;
    questionsJson?: string | null;
  },
) =>
  invoke<import('@/lib/bindings/N8nSessionResponse').N8nSessionResponse>(
    "update_n8n_session",
    { params: { id, ...updates } },
  );

export const deleteN8nSession = (id: string) =>
  invoke<boolean>("delete_n8n_session", { id });
