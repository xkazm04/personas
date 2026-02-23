import { invoke } from "@tauri-apps/api/core";

import type { Persona } from "@/lib/bindings/Persona";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { N8nPersonaDraft, TransformQuestionResponse } from "@/api/n8nTransform";

// ============================================================================
// Template Adoption — types
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

// ============================================================================
// Template Adoption — commands
// ============================================================================

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
  invoke<TemplateAdoptSnapshot>("get_template_adopt_snapshot", { adoptId });

export const clearTemplateAdoptSnapshot = (adoptId: string) =>
  invoke<void>("clear_template_adopt_snapshot", { adoptId });

export const cancelTemplateAdopt = (adoptId: string) =>
  invoke<void>("cancel_template_adopt", { adoptId });

export const confirmTemplateAdoptDraft = (draftJson: string) =>
  invoke<{ persona: Persona }>("confirm_template_adopt_draft", { draftJson });

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

export const instantAdoptTemplate = (
  templateName: string,
  designResultJson: string,
) =>
  invoke<{ persona: Persona }>("instant_adopt_template", {
    templateName,
    designResultJson,
  });

// ============================================================================
// Template Generation — types
// ============================================================================

export interface TemplateGenerateSnapshot {
  gen_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  error: string | null;
  lines: string[];
  result_json: string | null;
}

// ============================================================================
// Template Generation — commands
// ============================================================================

export const generateTemplateBackground = (
  genId: string,
  templateName: string,
  description: string,
) =>
  invoke<{ gen_id: string }>("generate_template_background", {
    genId,
    templateName,
    description,
  });

export const getTemplateGenerateSnapshot = (genId: string) =>
  invoke<TemplateGenerateSnapshot>("get_template_generate_snapshot", { genId });

export const clearTemplateGenerateSnapshot = (genId: string) =>
  invoke<void>("clear_template_generate_snapshot", { genId });

export const cancelTemplateGenerate = (genId: string) =>
  invoke<void>("cancel_template_generate", { genId });

export const saveCustomTemplate = (
  templateName: string,
  instruction: string,
  designResultJson: string,
) =>
  invoke<{ review: PersonaDesignReview }>("save_custom_template", {
    templateName,
    instruction,
    designResultJson,
  });
