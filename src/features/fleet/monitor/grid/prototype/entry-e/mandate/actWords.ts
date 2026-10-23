// What an act decided, in words: the verdict token the backend stores
// (`charter_acts.verdict`) as a verb, and the item it was taken on as a title.
// Read by the act log's rows and by the dock's act ticker, so the two can
// never word the same act differently.
//
// The verdict tokens are the writers' own: the router's `RouterAct::verdict`
// (`engine/src/mandate_router.rs`: "filed as evidence", "approved",
// "acknowledged"), the envelope doors in `db/src/repos/core/mandates.rs`
// ("signed", "widened", "narrowed", "merge-policy-set", "budget-set",
// "suspended", "resumed", "reverted", and WP6's "dropped", "kept", "drafted",
// "adopted"), and the steward's idea verdicts. A token
// none of them writes reads as "decided", never as the raw token.
//
// Every verb has its own words in the act log AND the dock's ticker: the
// switches over `ActVerb` here and in `dockActLine` have no default, so a
// verb added to the union fails tsc until both say it (`ACT_VERBS` pins the
// list a test walks).

import type { Translations } from '@/i18n/generated/types';
import type { CharterAct } from '@/lib/bindings/CharterAct';

type M = Translations['monitor'];

export const ACT_VERBS = [
  'filed', 'approved', 'acknowledged', 'accepted', 'rejected',
  'signed', 'widened', 'narrowed', 'merge_set', 'budget_set',
  'suspended', 'resumed', 'reverted', 'dropped', 'kept', 'drafted', 'adopted', 'decided',
] as const;

export type ActVerb = (typeof ACT_VERBS)[number];

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
    case 'dropped': return 'dropped';
    case 'kept': return 'kept';
    case 'drafted': return 'drafted';
    case 'adopted': return 'adopted';
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
    case 'dropped': return m.ml_verb_dropped;
    case 'kept': return m.ml_verb_kept;
    case 'drafted': return m.ml_verb_drafted;
    case 'adopted': return m.ml_verb_adopted;
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
  /** On a drop: the operator's reason. */
  reason: string | null;
}

export function shownWords(json: string | null): ShownWords {
  if (!json) return { title: null, verdict: null, reason: null };
  try {
    // A stored JSON text of unknown shape: read only string fields, by name.
    const v: unknown = JSON.parse(json);
    if (typeof v !== 'object' || v === null) return { title: null, verdict: null, reason: null };
    const o = v as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === 'string' && x.trim() !== '' ? x : null);
    return { title: str(o.title), verdict: str(o.verdict), reason: str(o.reason) };
  } catch {
    // intentional: a malformed shown_json only costs the title; the kind stands in.
    return { title: null, verdict: null, reason: null };
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
  if (act.itemKind === 'mandate') {
    const what = mandateTitle ?? m.ml_kind_mandate;
    return {
      verb,
      what: shown.reason ? m.ml_act_what_reason.replace('{what}', what).replace('{reason}', shown.reason) : what,
    };
  }
  return { verb, what: shown.title ?? kindLabel(m, act.itemKind) };
}
