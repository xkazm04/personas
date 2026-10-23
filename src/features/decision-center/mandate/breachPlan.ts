/**
 * breachPlan — what the Breach card offers for one item, from data only.
 *
 * The clause (why the item reached the operator) is the router's, shipped on
 * the lanes snapshot; nothing here re-routes. Given the clause and the
 * mandate as `mandate_list` returns it, the plan says what "amend" (key 1)
 * means:
 *
 *  - `scope` on a signed, active mandate, for a kind one scope releases:
 *    widen the envelope by that scope (`mandate_amend` widenScope).
 *  - `merge` on a signed, active mandate whose policy is `never`: let merges
 *    land when the gates are green (setMergePolicy). Arms: a merge cannot be
 *    taken back.
 *  - `spend` on a signed, active mandate: raise the monthly cap to a figure
 *    the operator types (setBudget). Arms: money spent stays spent.
 *  - otherwise (stop, risk, unsigned, or no envelope to change): decide the
 *    item itself, which arms only when the item is irreversible.
 *
 * The clause diff ("what would change if amended") exists only for the three
 * envelope amends, where both sides are known.
 *
 * The card's head reads `breachOutcomes`: one "If you <verb>" line per
 * numbered verdict the dock prints (amend, deny, then suspend when there is a
 * mandate to suspend), in the dock's order, so the head never promises a pair
 * of verdicts the dock does not have. The item's own branches (4-9) carry
 * their hint inside their button and get no line.
 *
 * `mandateStateOf` says what is true about the item's mandate when the card
 * cannot amend it: unsigned (which project, what signing would change), no
 * mandate at all (the Orphans lane), or a mandate that did not load. React-free.
 */
import type { TriageReasonPrompt } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecideScope } from '@/lib/bindings/DecideScope';
import type { LaneClause } from '@/lib/bindings/LaneClause';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { MergePolicy } from '@/lib/bindings/MergePolicy';

import { mergeLabel, scopeLabel } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/mandateCopy';

import type { Interpolate, MonitorCopy } from '../deck/deckMeta';
import { noEffect, yesOutcome, type Outcome } from '../deck/outcome';
import type { DecisionItem } from '../model/decisionModel';
import { scopeForKind } from './scopeForKind';

export type BreachAmend =
  | { kind: 'item' }
  | { kind: 'scope'; scope: DecideScope }
  | { kind: 'merge'; from: MergePolicy; to: MergePolicy }
  | { kind: 'spend'; from: number | null };

export interface BreachPlan {
  clause: LaneClause;
  amend: BreachAmend;
  /** The amend arms first (merge or spend leaves for good). */
  arms: 'merge' | 'spend' | null;
  /** The item sits on an active mandate the operator can suspend. */
  canSuspend: boolean;
}

/** A signed, active envelope: the only kind an amend can change. */
function amendable(mandate: MandateSummary | null): mandate is MandateSummary {
  return !!mandate && mandate.status === 'active' && mandate.envelope.envelopeVersion > 0;
}

export function breachPlan(item: DecisionItem, clause: LaneClause, mandate: MandateSummary | null): BreachPlan {
  const canSuspend = !!mandate && mandate.status === 'active';
  const own = (): BreachPlan => {
    const irr = item.irreversible;
    return { clause, amend: { kind: 'item' }, arms: irr === 'merge' || irr === 'spend' ? irr : null, canSuspend };
  };
  if (!amendable(mandate)) return own();
  const env = mandate.envelope;
  if (clause === 'scope') {
    const scope = scopeForKind(item.kind);
    if (scope && !env.decideScopes.includes(scope)) return { clause, amend: { kind: 'scope', scope }, arms: null, canSuspend };
    return own();
  }
  if (clause === 'merge' && env.mergePolicy === 'never') {
    return { clause, amend: { kind: 'merge', from: 'never', to: 'gate-green' }, arms: 'merge', canSuspend };
  }
  if (clause === 'spend') return { clause, amend: { kind: 'spend', from: env.budgetMonthlyUsd }, arms: 'spend', canSuspend };
  return own();
}

/** Why the item reached the operator, in one plain sentence. */
export function clauseLine(m: MonitorCopy, clause: LaneClause): string {
  switch (clause) {
    case 'stop': return m.ml_clause_stop;
    case 'valve': return m.ml_clause_valve;
    case 'risk': return m.ml_clause_risk;
    case 'merge': return m.ml_clause_merge;
    case 'spend': return m.ml_clause_spend;
    case 'scope': return m.ml_clause_scope;
    case 'unsigned': return m.ml_clause_unsigned;
    case 'none': return m.ml_clause_none;
  }
}

type Preset = [id: string, value: string, label: (m: MonitorCopy) => string];

/** One-key reasons per clause. `value` is what is written: durable English, never localised. */
const DENY_PRESETS: Partial<Record<LaneClause, Preset[]>> = {
  stop: [['root', 'Find the root cause first', (m) => m.ml_deny_stop_root], ['upstream', 'Hold until the upstream recovers', (m) => m.ml_deny_stop_upstream]],
  risk: [['tests', 'Too risky without tests', (m) => m.ml_deny_risk_tests], ['review', 'Needs a human review first', (m) => m.ml_deny_risk_review]],
  merge: [['self', 'I review merges on this mandate myself', (m) => m.ml_deny_merge_self], ['look', 'The branch needs a second look', (m) => m.ml_deny_merge_look]],
  spend: [['worth', 'Not worth the spend today', (m) => m.ml_deny_spend_worth], ['cheaper', 'Find a cheaper path first', (m) => m.ml_deny_spend_cheaper]],
};

const SCOPE_PRESETS: Preset[] = [
  ['not_mandate', 'Not for this mandate', (m) => m.ml_deny_scope_not],
  ['ask_each', 'Ask me each time for these', (m) => m.ml_deny_scope_ask],
];

/** The deny prompt (key 2): the clause's reasons, free text, Enter denies without one. */
export function denyPrompt(m: MonitorCopy, clause: LaneClause): TriageReasonPrompt {
  const presets = DENY_PRESETS[clause] ?? SCOPE_PRESETS;
  return {
    on: 'reject',
    title: m.ml_deny_title,
    options: presets.map(([id, value, label]) => ({ id, value, label: label(m) })),
    skipLabel: m.ml_deny_skip,
    freeText: true,
  };
}

/** What the card can truthfully say about the item's mandate. */
export type BreachMandateState =
  | { kind: 'signed' }
  | { kind: 'unsigned'; project: string }
  | { kind: 'none'; project: string }
  | { kind: 'no-project' }
  | { kind: 'unread' };

/**
 * The item's mandate as the card knows it: a summary from `mandate_list`, or
 * only the snapshot's charter id (the summary did not load), or no charter.
 * `projectName` is the project's name when the caller could resolve it.
 */
export function mandateStateOf(
  charterId: string | null,
  mandate: MandateSummary | null,
  projectId: string | null,
  projectName: string | null,
  unknownProject: string,
): BreachMandateState {
  if (mandate) {
    if (mandate.envelope.envelopeVersion > 0) return { kind: 'signed' };
    return { kind: 'unsigned', project: mandate.projectName ?? projectName ?? unknownProject };
  }
  if (charterId) return { kind: 'unread' };
  if (!projectId) return { kind: 'no-project' };
  return { kind: 'none', project: projectName ?? unknownProject };
}

/** The mandate state in one plain sentence, or null for a signed mandate (the envelope speaks for itself). */
export function mandateStateLine(m: MonitorCopy, tx: Interpolate, state: BreachMandateState): string | null {
  switch (state.kind) {
    case 'signed': return null;
    case 'unsigned': return tx(m.ml_breach_state_unsigned, { project: state.project });
    case 'none': return tx(m.ml_breach_state_none, { project: state.project });
    case 'no-project': return m.ml_breach_state_no_project;
    case 'unread': return m.ml_breach_state_unread;
  }
}

export interface BreachOutcomeContext {
  /** The project whose mandate a suspend would hold. */
  project: string;
  /** The cap a spend amend would set, as typed; null until typed. */
  cap: number | null;
  usd: (usd: number) => string;
}

/** One outcome line per numbered verdict in the Breach dock, in its order: amend, deny, suspend. */
export function breachOutcomes(m: MonitorCopy, tx: Interpolate, item: DecisionItem, plan: BreachPlan, ctx: BreachOutcomeContext): Outcome[] {
  const a = plan.amend;
  let amend: Outcome;
  switch (a.kind) {
    case 'scope': amend = { verb: m.ml_breach_out_widen_verb, effect: tx(m.ml_breach_out_widen, { scope: scopeLabel(m, a.scope) }) }; break;
    case 'merge': amend = { verb: m.ml_breach_out_merge_verb, effect: tx(m.ml_breach_out_merge, { policy: mergeLabel(m, a.to) }) }; break;
    case 'spend': amend = { verb: m.ml_breach_out_spend_verb, effect: tx(m.ml_breach_out_spend, { cap: ctx.usd(ctx.cap ?? a.from ?? 0) }) }; break;
    case 'item': amend = yesOutcome(m, tx, item); break;
  }
  const out: Outcome[] = [
    amend,
    { verb: m.ml_breach_out_deny_verb, effect: tx(m.ml_breach_out_deny, { effect: noEffect(m, item.kind) }) },
  ];
  if (plan.canSuspend) out.push({ verb: m.ml_breach_out_suspend_verb, effect: tx(m.ml_breach_out_suspend, { project: ctx.project }) });
  return out;
}
