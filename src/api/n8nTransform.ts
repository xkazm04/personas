import { invoke } from "@tauri-apps/api/core";

import type { Persona } from "@/lib/bindings/Persona";

// ============================================================================
// N8n Transform — types
// ============================================================================

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
  type: 'select' | 'text' | 'boolean';
  options?: string[];
  default?: string;
  context?: string;
}

export interface N8nTransformSnapshot {
  transform_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  draft: N8nPersonaDraft | null;
  questions: TransformQuestionResponse[] | null;
}

// ============================================================================
// N8n Transform — commands
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
    adjustmentRequest: adjustmentRequest ?? null,
    previousDraftJson: previousDraftJson ?? null,
    connectorsJson: connectorsJson ?? null,
    credentialsJson: credentialsJson ?? null,
    userAnswersJson: userAnswersJson ?? null,
    sessionId: sessionId ?? null,
  });

export const getN8nTransformSnapshot = (transformId: string) =>
  invoke<N8nTransformSnapshot>("get_n8n_transform_snapshot", { transformId });

export const clearN8nTransformSnapshot = (transformId: string) =>
  invoke<void>("clear_n8n_transform_snapshot", { transformId });

export const cancelN8nTransform = (transformId: string) =>
  invoke<void>("cancel_n8n_transform", { transformId });

export const confirmN8nPersonaDraft = (draftJson: string) =>
  invoke<{ persona: Persona }>("confirm_n8n_persona_draft", { draftJson });

export const continueN8nTransform = (
  transformId: string,
  userAnswersJson: string,
  sessionId?: string | null,
) =>
  invoke<{ transform_id: string }>("continue_n8n_transform", {
    transformId,
    userAnswersJson,
    sessionId: sessionId ?? null,
  });

// ============================================================================
// N8n Transform Sessions (persisted wizard state)
// ============================================================================

export type { N8nTransformSession } from '@/lib/bindings/N8nTransformSession';

export const createN8nSession = (
  workflowName: string,
  rawWorkflowJson: string,
  step: string,
  status: string,
) =>
  invoke<import('@/lib/bindings/N8nTransformSession').N8nTransformSession>(
    "create_n8n_session",
    { workflowName, rawWorkflowJson, step, status },
  );

export const getN8nSession = (id: string) =>
  invoke<import('@/lib/bindings/N8nTransformSession').N8nTransformSession>(
    "get_n8n_session",
    { id },
  );

export const listN8nSessions = () =>
  invoke<import('@/lib/bindings/N8nTransformSession').N8nTransformSession[]>(
    "list_n8n_sessions",
  );

export const updateN8nSession = (
  id: string,
  updates: {
    workflowName?: string;
    status?: string;
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
  invoke<import('@/lib/bindings/N8nTransformSession').N8nTransformSession>(
    "update_n8n_session",
    { id, ...updates },
  );

export const deleteN8nSession = (id: string) =>
  invoke<boolean>("delete_n8n_session", { id });
