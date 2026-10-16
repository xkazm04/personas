import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import type { QuestionGroup } from '@/features/agents/quick-answer/usePendingInteractions';
import { isComplexQuestion } from '@/features/agents/quick-answer/usePendingInteractions';

/* ----------------------------------------------------------------------------
 * NEEDS YOU - one queue of what a project holds for the operator (WP12).
 *
 * Today's rail had two tabs for one question, "what waits on me here?":
 * Reviews (the team's held steps) and Quick (held build questions). They are
 * ONE queue now, in the deck's order: tier first (1 a review that holds a
 * team step, 2 everything else to decide), then the longest wait. Pure: the
 * hooks feed it, the rail and the projects list read it.
 * -------------------------------------------------------------------------- */

export type AskTier = 1 | 2;

interface AskBase { id: string; personaId: string; title: string; tier: AskTier; at: string | null }

export interface ReviewAsk extends AskBase {
  kind: 'review';
  body: string | null;
  /** A suggested action is a branch: resolving with it dispatches the follow-up run. */
  actions: string[];
  executionId: string | null;
}

export interface QuestionAsk extends AskBase {
  kind: 'question';
  sessionId: string;
  cellKey: string;
  options: string[];
  /** Needs the full builder (a connector picker, a file or a webhook source). */
  complex: boolean;
}

export type Ask = ReviewAsk | QuestionAsk;

export function reviewAsk(r: PersonaManualReview): ReviewAsk {
  return {
    kind: 'review',
    id: r.id,
    personaId: r.persona_id,
    title: r.title,
    body: r.description,
    // The roster's tier law (`decisionTier`): a review that holds a team step blocks a run.
    tier: r.assignment_id || r.step_id ? 1 : 2,
    at: r.created_at,
    actions: parseSuggestedActions(r.suggested_actions),
    executionId: r.execution_id,
  };
}

export function questionAsks(group: QuestionGroup): QuestionAsk[] {
  return group.questions.map((q) => ({
    kind: 'question',
    id: `${group.sessionId}:${q.cellKey}`,
    personaId: group.personaId,
    title: q.question,
    tier: 2,
    at: null,
    sessionId: group.sessionId,
    cellKey: q.cellKey,
    options: q.options ?? [],
    complex: isComplexQuestion(q),
  }));
}

/** Tier, then the longest wait first; an ask with no timestamp (a held question) after the dated ones of its tier. */
export function compareAsk(a: Ask, b: Ask): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.at && !b.at) return -1;
  if (!a.at && b.at) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Reviews and held questions as ONE queue. */
export function buildAsks(reviews: readonly PersonaManualReview[], groups: readonly QuestionGroup[]): Ask[] {
  return [...reviews.map(reviewAsk), ...groups.flatMap(questionAsks)].sort(compareAsk);
}

/** The asks of a scope (a team's members, or one persona); `null` is the whole fleet. */
export function scopeAsks(asks: readonly Ask[], personaIds: ReadonlySet<string> | null): Ask[] {
  return personaIds ? asks.filter((a) => personaIds.has(a.personaId)) : [...asks];
}
