import { invoke } from "@tauri-apps/api/core";

import type { Persona } from "@/lib/bindings/Persona";

// ============================================================================
// Design
// ============================================================================

export interface DesignStartResult {
  design_id: string;
}

export interface FeasibilityResult {
  confirmed_capabilities: string[];
  issues: string[];
  overall: string;
}

export const startDesignAnalysis = (instruction: string, personaId: string) =>
  invoke<DesignStartResult>("start_design_analysis", { instruction, personaId });

export const refineDesign = (personaId: string, feedback: string, currentResult?: string | null) =>
  invoke<DesignStartResult>("refine_design", { personaId, feedback, currentResult: currentResult ?? null });

export const testDesignFeasibility = (designResult: string) =>
  invoke<FeasibilityResult>("test_design_feasibility", { designResult });

export const cancelDesignAnalysis = () =>
  invoke<void>("cancel_design_analysis");

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

export interface N8nTransformSnapshot {
  transform_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  draft: N8nPersonaDraft | null;
  questions: TransformQuestionResponse[] | null;
}

export const transformN8nToPersona = (
  transformId: string,
  workflowName: string,
  workflowJson: string,
  parserResultJson: string,
  adjustmentRequest?: string | null,
  previousDraftJson?: string | null,
) =>
  invoke<N8nTransformResult>("transform_n8n_to_persona", {
    transformId,
    workflowName,
    workflowJson,
    parserResultJson,
    adjustmentRequest: adjustmentRequest ?? null,
    previousDraftJson: previousDraftJson ?? null,
  });

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
  invoke<N8nTransformSnapshot>("get_n8n_transform_snapshot", {
    transformId,
  });

export const clearN8nTransformSnapshot = (transformId: string) =>
  invoke<void>("clear_n8n_transform_snapshot", {
    transformId,
  });

export const cancelN8nTransform = (transformId: string) =>
  invoke<void>("cancel_n8n_transform", {
    transformId,
  });

export const confirmN8nPersonaDraft = (draftJson: string) =>
  invoke<{ persona: Persona }>("confirm_n8n_persona_draft", {
    draftJson,
  });

export interface TransformQuestionResponse {
  id: string;
  question: string;
  type: 'select' | 'text' | 'boolean';
  options?: string[];
  default?: string;
  context?: string;
}

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

// ============================================================================
// Template Adoption (CLI-driven)
// ============================================================================

export interface TemplateAdoptStartResult {
  adopt_id: string;
}

export interface TemplateAdoptSnapshot {
  adopt_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  draft: N8nPersonaDraft | null;
  questions: TransformQuestionResponse[] | null;
}

export const startTemplateAdoptBackground = (
  adoptId: string,
  templateName: string,
  designResultJson: string,
  adjustmentRequest?: string | null,
  previousDraftJson?: string | null,
  userAnswersJson?: string | null,
) =>
  invoke<TemplateAdoptStartResult>("start_template_adopt_background", {
    adoptId,
    templateName,
    designResultJson,
    adjustmentRequest: adjustmentRequest ?? null,
    previousDraftJson: previousDraftJson ?? null,
    userAnswersJson: userAnswersJson ?? null,
  });

export const getTemplateAdoptSnapshot = (adoptId: string) =>
  invoke<TemplateAdoptSnapshot>("get_template_adopt_snapshot", {
    adoptId,
  });

export const clearTemplateAdoptSnapshot = (adoptId: string) =>
  invoke<void>("clear_template_adopt_snapshot", {
    adoptId,
  });

export const cancelTemplateAdopt = (adoptId: string) =>
  invoke<void>("cancel_template_adopt", {
    adoptId,
  });

export const confirmTemplateAdoptDraft = (draftJson: string) =>
  invoke<{ persona: Persona }>("confirm_template_adopt_draft", {
    draftJson,
  });

export const generateTemplateAdoptQuestions = (
  templateName: string,
  designResultJson: string,
) =>
  invoke<TransformQuestionResponse[]>("generate_template_adopt_questions", {
    templateName,
    designResultJson,
  });

export const continueTemplateAdopt = (
  adoptId: string,
  userAnswersJson: string,
) =>
  invoke<{ adopt_id: string }>("continue_template_adopt", {
    adoptId,
    userAnswersJson,
  });
