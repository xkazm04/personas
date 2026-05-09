import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { Persona } from "@/lib/bindings/Persona";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import type { N8nPersonaDraft, TransformQuestionResponse } from "@/api/templates/n8nTransform";

export interface TemplateAdoptSnapshot {
  adopt_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  draft: N8nPersonaDraft | null;
  questions: TransformQuestionResponse[] | null;
}

// ============================================================================
// Template Adoption -- commands
// ============================================================================
//
// 2026-05-09 — Six legacy adoption-job commands removed (Stage A1):
//   start_template_adopt_background, clear_template_adopt_snapshot,
//   cancel_template_adopt, confirm_template_adopt_draft,
//   generate_template_adopt_questions, continue_template_adopt.
// The modal flow at MatrixAdoptionView uses inline questionnaire +
// create_adoption_session instead. The two surviving commands below
// remain wired:
//   - getTemplateAdoptSnapshot: polled by useAdoptionCompletionNotifier
//   - instantAdoptTemplate: dev-tools Dev Clone shortcut

export const getTemplateAdoptSnapshot = (adoptId: string) =>
  invoke<TemplateAdoptSnapshot>("get_template_adopt_snapshot", { adoptId });

export const instantAdoptTemplate = (
  templateName: string,
  designResultJson: string,
) =>
  invoke<{ persona: Persona }>("instant_adopt_template", {
    templateName,
    designResultJson,
  });

// ============================================================================
// Template Generation -- types
// ============================================================================

export interface TemplateGenerateSnapshot {
  gen_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  error: string | null;
  lines: string[];
  result_json: string | null;
}

// ============================================================================
// Template Generation -- commands
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
