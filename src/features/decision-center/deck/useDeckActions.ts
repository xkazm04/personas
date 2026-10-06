/**
 * The deck's verbs, shared by the keyboard and the dock buttons so a key and a
 * click can never mean two different things. Each one maps to a contract
 * verdict (`DeckVerdict`) and a leave gesture (`deckMotion.Leave`).
 */
import { modalTypeOf } from '../model/decisionModel';
import type { DeckController } from './useDeck';

/** Council: a send-back needs a written reason of at least this length. */
export const SEND_BACK_MIN = 12;

export interface DeckExtras {
  rating: number | null;
  answers: Record<string, string>;
  /** A question card was submitted with an empty field. */
  onIncomplete: () => void;
}

export function useDeckActions(deck: DeckController, extras: DeckExtras) {
  const item = deck.item;
  const type = item ? modalTypeOf(item.kind) : 'approval';

  const done = (branchId?: string) =>
    deck.decide({ verdict: 'done', branchId, reason: extras.rating ? `rated ${extras.rating}/5` : undefined }, 'done');

  const accept = () => {
    if (!item) return;
    if (item.kind === 'council') {
      if (deck.armed === 'accept') deck.decide({ verdict: 'accept' }, 'accept');
      else deck.setArmed('accept');
      return;
    }
    if (type === 'report') { done(); return; }
    if (type === 'chat') return;
    if (item.input) {
      const missing = item.input.fields.some((f) => !f.deferred && !extras.answers[f.key]?.trim());
      if (missing) { extras.onIncomplete(); return; }
      // The contract has no `answers` field yet; the batch rides in `text`.
      deck.decide({ verdict: 'accept', text: JSON.stringify(extras.answers) }, 'accept');
      return;
    }
    deck.decide({ verdict: 'accept' }, 'accept');
  };

  /** Enter: confirm whatever is armed. Returns false when nothing was. */
  const confirm = (): boolean => {
    if (deck.armed === 'accept') { accept(); return true; }
    if (deck.armed === 'reject') { deck.reject(); return true; }
    return false;
  };

  const branch = (n: number): boolean => {
    const b = item?.branches[n - 1];
    if (!b) return false;
    if (type === 'report') done(b.id);
    else deck.decide({ verdict: 'accept', branchId: b.id }, 'accept');
    return true;
  };

  const submitReason = (reason?: string) => {
    deck.setPrompt(null);
    deck.decide({ verdict: 'reject', reason }, 'reject');
  };

  return {
    type,
    accept,
    reject: deck.reject,
    confirm,
    skip: () => deck.decide({ verdict: 'skip' }, 'skip'),
    done: () => done(),
    branch,
    reply: (text: string) => deck.decide({ verdict: 'reply', text }, 'accept'),
    submitReason,
  };
}

export type DeckActions = ReturnType<typeof useDeckActions>;
