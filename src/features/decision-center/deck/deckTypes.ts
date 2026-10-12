/**
 * What a deck card hands back when the person acts on it. The host maps it to
 * the roster's decision (`DecisionDeckHost` -> `roster.decide`).
 */
import type { TriageVerdict } from '@/features/agents/quick-answer/triage/triageTypes';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { DecisionItem } from '../model/decisionModel';

/** The card title's id — the modal's accessible name. */
export const DECK_TITLE_ID = 'decision-deck-title';

export interface DeckVerdict {
  item: DecisionItem;
  /** Spine verdict, or `'done'` (report/chat read), `'reply'` (chat sent). */
  verdict: TriageVerdict | 'done' | 'reply';
  branchId?: string;
  reason?: string;
  /** Chat reply text. */
  text?: string;
  /** Question cards: every field filled in, by field key — submitted as ONE batch. */
  answers?: Record<string, string>;
  /** Report follow-up: the pending reviews of the same run, for the chat seed. */
  linkedReviews?: PersonaManualReview[];
}
