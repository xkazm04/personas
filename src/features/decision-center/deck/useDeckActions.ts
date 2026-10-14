/**
 * The deck's verbs, shared by the keyboard and the dock buttons so a key and a
 * click can never mean two different things. Each one maps to a deck verdict
 * (`DeckVerdict`) and a leave gesture (`deckMotion.Leave`).
 *
 * A `readOnly` deck (a history row opened as `single`) has no verbs at all:
 * every one of them is a no-op, so neither a key nor a stray click can write.
 */
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import { modalTypeOf, type DecisionItem } from '../model/decisionModel';
import type { DeckController } from './useDeck';

export interface DeckExtras {
  answers: Record<string, string>;
  /** A question card was submitted with an empty field. */
  onIncomplete: () => void;
  /** The report's same-run pending reviews, carried into a chat follow-up. */
  linkedReviews: PersonaManualReview[];
  readOnly: boolean;
  /** Follow one of the card's `links` — navigation, never a decision. */
  onOpenLink: (item: DecisionItem, linkId: string) => void;
}

/**
 * Whether saying yes ARMS first: a council verdict (the human gate on a
 * round), and any item whose `irreversible` is set (a valve: the first press
 * shows what leaves, the second press or Enter confirms, Esc disarms).
 */
export function armsAccept(item: DecisionItem): boolean {
  return item.kind === 'council' || !!item.irreversible;
}

export function useDeckActions(deck: DeckController, extras: DeckExtras) {
  const item = deck.item;
  const type = item ? modalTypeOf(item.kind) : 'approval';
  const live = !extras.readOnly;

  const done = (branchId?: string) => {
    if (!live) return;
    deck.decide({ verdict: 'done', branchId, linkedReviews: branchId ? extras.linkedReviews : undefined }, 'done');
  };

  const accept = () => {
    if (!item || !live) return;
    if (armsAccept(item) && deck.armed !== 'accept') { deck.setArmed('accept'); return; }
    if (item.kind === 'council') { deck.decide({ verdict: 'accept' }, 'accept'); return; }
    if (type === 'report') { done(); return; }
    if (type === 'chat') return;
    if (item.input) {
      const missing = item.input.fields.some((f) => !f.deferred && !extras.answers[f.key]?.trim());
      if (missing) { extras.onIncomplete(); return; }
      deck.decide({ verdict: 'accept', answers: extras.answers }, 'accept');
      return;
    }
    deck.decide({ verdict: 'accept' }, 'accept');
  };

  const reject = () => {
    if (live) deck.reject();
  };

  /** Enter: confirm whatever is armed. Returns false when nothing was. */
  const confirm = (): boolean => {
    if (!live) return false;
    if (deck.armed === 'accept') { accept(); return true; }
    if (deck.armed === 'reject') { deck.reject(); return true; }
    return false;
  };

  const branch = (n: number): boolean => {
    const b = item?.branches[n - 1];
    if (!b || !live) return false;
    if (type === 'report') done(b.id);
    else deck.decide({ verdict: 'accept', branchId: b.id }, 'accept');
    return true;
  };

  const submitReason = (reason?: string) => {
    deck.setPrompt(null);
    if (live) deck.decide({ verdict: 'reject', reason }, 'reject');
  };

  return {
    type,
    readOnly: !live,
    accept,
    reject,
    confirm,
    skip: () => { if (live) deck.decide({ verdict: 'skip' }, 'skip'); },
    done: () => done(),
    branch,
    reply: (text: string) => { if (live) deck.decide({ verdict: 'reply', text }, 'accept'); },
    submitReason,
    openLink: (linkId: string) => { if (item) extras.onOpenLink(item, linkId); },
  };
}

export type DeckActions = ReturnType<typeof useDeckActions>;
