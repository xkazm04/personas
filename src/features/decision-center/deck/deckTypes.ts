/**
 * What a deck card hands back when the person acts on it. The host maps it to
 * the roster's decision (`DecisionDeckHost` -> `roster.decide`).
 */
import type { TriageVerdict } from '@/features/agents/quick-answer/triage/triageTypes';
import type { MandateChange } from '@/lib/bindings/MandateChange';
import type { MandateSignInput } from '@/lib/bindings/MandateSignInput';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { DecisionItem } from '../model/decisionModel';

/** A Breach card's act on the item's MANDATE, taken instead of a verdict on the item. */
export type MandateAct =
  | { op: 'amend'; charterId: string; change: MandateChange }
  | { op: 'suspend'; charterId: string };

/** The card title's id — the modal's accessible name. */
export const DECK_TITLE_ID = 'decision-deck-title';

/**
 * What the host says about a verdict that landed. `receipt` replaces the
 * tray's default receipt ("Accepted: <title>") when the write did something
 * else than decide here: a verdict on a mirrored mandate waits, queued, for
 * its home device (residue item 6).
 */
export interface DeckLanded {
  receipt?: string;
}

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
  /** Sign card: the envelope as the card shows it at the moment of signing. */
  envelope?: MandateSignInput;
  /** Breach card: amend or suspend the mandate; the item itself stays undecided. */
  mandateAct?: MandateAct;
}
