/**
 * What a deck card hands back when the person acts on it. Formerly the
 * prototype round's `PrototypeVerdict`; same shape, now the deck's own.
 */
import type { TriageVerdict } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionItem } from '../model/decisionModel';

export interface DeckVerdict {
  item: DecisionItem;
  /** Spine verdict, or `'done'` (report/chat read), `'reply'` (chat sent). */
  verdict: TriageVerdict | 'done' | 'reply';
  branchId?: string;
  reason?: string;
  /** Chat reply text. */
  text?: string;
}
