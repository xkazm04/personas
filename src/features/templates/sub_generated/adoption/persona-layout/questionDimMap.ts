import type { GlyphDimension } from '@/features/shared/glyph';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import { QUESTION_CATEGORY_TO_DIM } from '../questionnaire/questionnaireGlyphRow';

/**
 * Map an adoption question to the persona dimension whose petal should
 * surface it. Best-effort heuristic — questions describe how to seed
 * one of the persona's 8 dimensions, so each question can be routed to
 * a petal even when the template author didn't annotate it explicitly.
 *
 * Precedence:
 *   1. `vault_category` set → connector dim (this is always a vault pick)
 *   2. category string match → matching dim
 *   3. fallback → `task` (catch-all; surfaces on the What petal)
 *
 * The category table itself is NOT restated here. It used to be a hand-kept
 * `switch` that duplicated `QUESTION_CATEGORY_TO_DIM` and had drifted from it
 * (`boundaries` reached neither), so this routes through that one authority —
 * which is completeness-checked against `QUESTIONNAIRE_CATEGORY_ORDER`.
 */
export function questionToDimension(q: TransformQuestionResponse): GlyphDimension {
  if (q.vault_category) return 'connector';
  return (q.category ? QUESTION_CATEGORY_TO_DIM[q.category] : undefined) ?? 'task';
}

/**
 * Group every question by its target dimension. Returned record always
 * contains all 8 keys (empty arrays when no questions land on that dim).
 */
export function groupQuestionsByDimension(
  questions: TransformQuestionResponse[],
): Record<GlyphDimension, TransformQuestionResponse[]> {
  const out: Record<GlyphDimension, TransformQuestionResponse[]> = {
    trigger: [],
    task: [],
    connector: [],
    message: [],
    review: [],
    memory: [],
    event: [],
    error: [],
  };
  for (const q of questions) {
    out[questionToDimension(q)].push(q);
  }
  return out;
}
