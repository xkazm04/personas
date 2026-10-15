// What an act decided, in words: the verdict token the backend stores
// (`charter_acts.verdict`) as a verb, and the item it was taken on as a title.
// Read by the act log's rows and by the dock's act ticker, so the two can
// never word the same act differently.
//
// The verdict tokens are the writers' own: the router's `RouterAct::verdict`
// (`engine/src/mandate_router.rs`: "filed as evidence", "approved",
// "acknowledged"), the envelope doors in `db/src/repos/core/mandates.rs`
// ("signed", "widened", "narrowed", "merge-policy-set", "budget-set",
// "suspended", "resumed", "reverted"), and the steward's idea verdicts. A token
// none of them writes reads as "decided", never as the raw token.

import type { Translations } from '@/i18n/generated/types';
import type { CharterAct } from '@/lib/bindings/CharterAct';

type M = Translations['monitor'];

export type ActVerb =
  | 'filed' | 'approved' | 'acknowledged' | 'accepted' | 'rejected'
  | 'signed' | 'widened' | 'narrowed' | 'merge_set' | 'budget_set'
  | 'suspended' | 'resumed' | 'reverted' | 'decided';

export function verbOf(verdict: string | null | undefined): ActVerb {
  switch (verdict) {
    case 'filed as evidence': return 'filed';
    case 'approved': return 'approved';
    case 'acknowledged': return 'acknowledged';
    case 'accepted': case 'accept': return 'accepted';
    case 'rejected': case 'reject': return 'rejected';
    case 'signed': return 'signed';
    case 'widened': return 'widened';
    case 'narrowed': return 'narrowed';
    case 'merge-policy-set': return 'merge_set';
    case 'budget-set': return 'budget_set';
    case 'suspended': return 'suspended';
    case 'resumed': return 'resumed';
    case 'reverted': return 'reverted';
    default: return 'decided';
  }
}

export function verbLabel(m: M, verb: ActVerb): string {
  switch (verb) {
    case 'filed': return m.ml_verb_filed;
    case 'approved': return m.ml_verb_approved;
    case 'acknowledged': return m.ml_verb_acknowledged;
    case 'accepted': return m.ml_verb_accepted;
    case 'rejected': return m.ml_verb_rejected;
    case 'signed': return m.ml_verb_signed;
    case 'widened': return m.ml_verb_widened;
    case 'narrowed': return m.ml_verb_narrowed;
    case 'merge_set': return m.ml_verb_merge_set;
    case 'budget_set': return m.ml_verb_budget_set;
    case 'suspended': return m.ml_verb_suspended;
    case 'resumed': return m.ml_verb_resumed;
    case 'reverted': return m.ml_verb_reverted;
    case 'decided': return m.ml_verb_decided;
  }
}

export function kindLabel(m: M, itemKind: string): string {
  switch (itemKind) {
    case 'report': return m.ml_kind_report;
    case 'review': return m.ml_kind_review;
    case 'incident': return m.ml_kind_incident;
    case 'idea': return m.ml_kind_idea;
    case 'mandate': return m.ml_kind_mandate;
    case 'act.revert': return m.ml_kind_act;
    default: return m.ml_kind_item;
  }
}

/** The fields of `shown_json` the words read; anything else in it is ignored. */
export interface ShownWords {
  title: string | null;
  /** On a revert act: the reverted act's verdict. */
  verdict: string | null;
}

export function shownWords(json: string | null): ShownWords {
  if (!json) return { title: null, verdict: null };
  try {
    // A stored JSON text of unknown shape: read only string fields, by name.
    const v: unknown = JSON.parse(json);
    if (typeof v !== 'object' || v === null) return { title: null, verdict: null };
    const o = v as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === 'string' && x.trim() !== '' ? x : null);
    return { title: str(o.title), verdict: str(o.verdict) };
  } catch {
    // intentional: a malformed shown_json only costs the title; the kind stands in.
    return { title: null, verdict: null };
  }
}

/**
 * The act's headline: what was done (the verb) and to what (the item's title
 * when the act recorded one, the reverted act's verb for a revert, the
 * mandate's title for an envelope act, else the kind in plain words).
 */
export function actHeadline(m: M, act: CharterAct, mandateTitle?: string | null): { verb: string; what: string } {
  const shown = shownWords(act.shownJson);
  const verb = verbLabel(m, verbOf(act.verdict));
  if (act.itemKind === 'act.revert') {
    return { verb, what: shown.verdict ? verbLabel(m, verbOf(shown.verdict)) : m.ml_kind_act };
  }
  if (act.itemKind === 'mandate') return { verb, what: mandateTitle ?? m.ml_kind_mandate };
  return { verb, what: shown.title ?? kindLabel(m, act.itemKind) };
}
