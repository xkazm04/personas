import type { GlyphDimension } from '@/features/shared/glyph';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

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
 */
export function questionToDimension(q: TransformQuestionResponse): GlyphDimension {
  if (q.vault_category) return 'connector';
  switch (q.category) {
    case 'credentials':
      return 'connector';
    case 'human_in_the_loop':
      return 'review';
    case 'memory':
      return 'memory';
    case 'notifications':
      return 'message';
    case 'quality':
      return 'error';
    case 'configuration':
    case 'domain':
    default:
      return 'task';
  }
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
