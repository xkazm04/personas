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
// The modal flow at ChronologyAdoptionView uses inline questionnaire +
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

/** Outcome of the always-on adoption adjustment pass. */
export interface AdoptionAdjustResult {
  /** `false` means the deterministic base IR was kept (fallback or no-op). */
  adjusted: boolean;
  divergence: string;
  model: string | null;
  /** Human-readable note, e.g. the fallback reason. */
  note: string | null;
  elapsedMs: number;
}

/**
 * Run the always-on adjustment pass on a draft build session, specializing its
 * `agent_ir` in place. Safe to call before `promoteBuildDraft`, and non-fatal
 * by contract: on any internal failure it RESOLVES with `adjusted: false` and
 * the base IR intact rather than rejecting.
 *
 * The 660s timeout sits above the backend's own 600s LLM margin so the
 * frontend never gives up before the backend resolves. Do not lower it here —
 * the whole point is that the wrapper owns the correct bound, so no call site
 * has to remember it.
 */
export const adjustAdoptionDraft = (sessionId: string) =>
  invoke<AdoptionAdjustResult>(
    "adjust_adoption_draft",
    { sessionId },
    { timeoutMs: 660_000 },
  );
