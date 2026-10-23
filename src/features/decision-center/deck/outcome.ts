/**
 * The card head's words: the context line and the OUTCOME PAIR, "If you <yes>:
 * ..." beside "If you <no>: ...", so the operator reads what each verdict does
 * before pressing either. React-free; every word resolves from the catalog
 * (`t.monitor.dc_deck_*`), never from a literal here.
 *
 * The no side is the verb the dock actually prints as the card's negative:
 * the reject verb on approval and backlog cards (and on a council verdict),
 * Later on a report (whose only quieter gesture is to leave it), Done on a
 * chat thread (closing it without a reply).
 */
import { modalTypeOf, type DecisionItem, type DecisionIrreversible, type DecisionKind } from '../model/decisionModel';
import type { Leave } from './deckMotion';
import { tierLabel, tierOf, yesDoes, type Interpolate, type MonitorCopy } from './deckMeta';

export interface Outcome { verb: string; effect: string }

/**
 * A card's outcome lines, one per verdict the dock prints, in the dock's
 * order. Most cards have the pair (yes, then no); a lane shape whose dock
 * offers other verbs builds its own list (the Breach card: amend, deny,
 * suspend, `breachOutcomes`), and the head renders whatever it is given.
 */
export type Outcomes = readonly Outcome[];

export function outcomePair(m: MonitorCopy, tx: Interpolate, item: DecisionItem): Outcomes {
  return [yesOutcome(m, tx, item), noOutcome(m, item)];
}

/** What the no side does to an item of this kind, in one sentence. */
export function noEffect(m: MonitorCopy, kind: DecisionKind): string {
  switch (kind) {
    case 'review': return m.dc_deck_no_review;
    case 'question': return m.dc_deck_no_question;
    case 'approval': return m.dc_deck_no_approval;
    case 'policy': return m.dc_deck_no_policy;
    case 'evolution': return m.dc_deck_no_evolution;
    case 'goal': return m.dc_deck_no_goal;
    case 'idea': return m.dc_deck_no_idea;
    case 'incident': return m.dc_deck_no_incident;
    case 'council': return m.dc_deck_no_council;
    case 'report': return m.dc_deck_no_report;
    case 'message': return m.dc_deck_no_chat;
    case 'mandate': return m.ml_sign_no;
    case 'build':
    case 'evidence':
    case 'release': return m.dc_deck_no_lens;
  }
}

export function yesOutcome(m: MonitorCopy, tx: Interpolate, item: DecisionItem): Outcome {
  const effect = yesDoes(m, tx, item);
  if (modalTypeOf(item.kind) === 'chat') return { verb: m.dc_deck_verb_reply, effect };
  if (item.kind === 'report') return { verb: m.dc_deck_verb_done, effect };
  return { verb: item.verdictLabels.accept.toLowerCase(), effect };
}

export function noOutcome(m: MonitorCopy, item: DecisionItem): Outcome {
  // A re-read has no drop: its other verb signs the edited envelope (WP6).
  const effect = item.kind === 'mandate' && item.payload?.reread ? m.ml_reread_no : noEffect(m, item.kind);
  if (modalTypeOf(item.kind) === 'chat') return { verb: m.dc_deck_verb_done, effect };
  if (item.kind === 'report') return { verb: m.dc_deck_verb_later, effect };
  return { verb: item.verdictLabels.reject.toLowerCase(), effect };
}

/** One line under the ask: the tier in words (the lamp only says it in a tooltip) and who raised it. */
export function contextLine(m: MonitorCopy, tx: Interpolate, item: DecisionItem): string {
  const from = item.source.sublabel
    ? tx(m.dc_deck_context_from_in, { name: item.source.label, place: item.source.sublabel })
    : tx(m.dc_deck_context_from, { name: item.source.label });
  return `${tierLabel(m, tierOf(item))} · ${from}`;
}

/** What leaves when an armed valve is confirmed, in plain words. */
export function leavesLine(m: MonitorCopy, tx: Interpolate, kind: DecisionIrreversible, title: string): string {
  switch (kind) {
    case 'merge': return tx(m.dc_deck_leaves_merge, { title });
    case 'spend': return tx(m.dc_deck_leaves_spend, { title });
    case 'outbound-message': return tx(m.dc_deck_leaves_outbound, { title });
    case 'deletion': return tx(m.dc_deck_leaves_deletion, { title });
  }
}

/** The receipt left in the tray after a verdict lands: "Accepted: <title>". */
export function receiptLine(m: MonitorCopy, tx: Interpolate, item: DecisionItem, leave: Exclude<Leave, 'walk' | 'skip'>): string {
  const chat = modalTypeOf(item.kind) === 'chat';
  const verdict = leave === 'reject'
    ? m.dc_deck_receipt_rejected
    : leave === 'done'
      ? (chat ? m.dc_deck_receipt_done : m.dc_deck_receipt_read)
      : chat ? m.dc_deck_receipt_sent : m.dc_deck_receipt_accepted;
  return tx(m.dc_deck_receipt, { verdict, title: item.title });
}
