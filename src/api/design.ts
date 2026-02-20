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

export const refineDesign = (personaId: string, feedback: string) =>
  invoke<DesignStartResult>("refine_design", { personaId, feedback });

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
}

export interface N8nTransformResult {
  draft: N8nPersonaDraft;
}

export interface N8nTransformStartResult {
  transform_id: string;
}

export interface N8nTransformSnapshot {
  transform_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  error: string | null;
  lines: string[];
  draft: N8nPersonaDraft | null;
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
) =>
  invoke<N8nTransformStartResult>("start_n8n_transform_background", {
    transformId,
    workflowName,
    workflowJson,
    parserResultJson,
    adjustmentRequest: adjustmentRequest ?? null,
    previousDraftJson: previousDraftJson ?? null,
  });

export const getN8nTransformSnapshot = (transformId: string) =>
  invoke<N8nTransformSnapshot>("get_n8n_transform_snapshot", {
    transformId,
  });

export const clearN8nTransformSnapshot = (transformId: string) =>
  invoke<void>("clear_n8n_transform_snapshot", {
    transformId,
  });

export const confirmN8nPersonaDraft = (draftJson: string) =>
  invoke<{ persona: Persona }>("confirm_n8n_persona_draft", {
    draftJson,
  });
