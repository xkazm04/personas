/**
 * envelope — the Sign card's draft of a mandate envelope, and what signing it
 * would grant. React-free.
 *
 * The draft is exactly what `mandate_sign` takes (`MandateSignInput`): the
 * whole envelope at once. It starts from the charter's stored envelope, which
 * for a draft is the column defaults (no scopes, merge `never`) plus the
 * charter's existing monthly cap.
 *
 * What a signature GRANTS is read off the draft, never guessed:
 *  - merge: any policy other than `never` lets a rung-3 worker merge alone.
 *  - spend: a cap above zero lets the steward spend inside it. `null` is no
 *    cap, and the router treats an uncapped spend as a breach (it never fits),
 *    so no cap delegates no spend at all.
 * Either grant arms the signature (the first press lists what it grants, the
 * second signs). `review.info` is called out on its own: the router approves
 * info reviews under it and no door returns a review to pending.
 */
import type { DecideScope } from '@/lib/bindings/DecideScope';
import type { MandateEnvelope } from '@/lib/bindings/MandateEnvelope';
import type { MandateSignInput } from '@/lib/bindings/MandateSignInput';
import type { MergePolicy } from '@/lib/bindings/MergePolicy';

/** Every scope, in the order the envelope document lists them. */
const SCOPE_ORDER: Record<DecideScope, number> = {
  'idea.accept': 0,
  'idea.reject': 1,
  'question.answer': 2,
  'review.info': 3,
  'incident.triage': 4,
  'report.read': 5,
  'council.attach': 6,
  dispatch: 7,
};

export const ALL_SCOPES: readonly DecideScope[] = (Object.keys(SCOPE_ORDER) as DecideScope[])
  .sort((a, b) => SCOPE_ORDER[a] - SCOPE_ORDER[b]);

export const MERGE_POLICIES: readonly MergePolicy[] = ['never', 'gate-green', 'gate-green+council-ready'];

export type EnvelopeGrant = 'merge' | 'spend';

export function draftFrom(env: MandateEnvelope): MandateSignInput {
  return {
    decideScopes: ALL_SCOPES.filter((s) => env.decideScopes.includes(s)),
    mergePolicy: env.mergePolicy,
    budgetMonthlyUsd: env.budgetMonthlyUsd,
  };
}

export function toggleScope(draft: MandateSignInput, scope: DecideScope): MandateSignInput {
  const on = draft.decideScopes.includes(scope);
  const next = on ? draft.decideScopes.filter((s) => s !== scope) : [...draft.decideScopes, scope];
  return { ...draft, decideScopes: ALL_SCOPES.filter((s) => next.includes(s)) };
}

/** What signing this draft grants that cannot be taken back once used. */
export function grantsOf(draft: MandateSignInput): EnvelopeGrant[] {
  const out: EnvelopeGrant[] = [];
  if (draft.mergePolicy !== 'never') out.push('merge');
  if (draft.budgetMonthlyUsd !== null && draft.budgetMonthlyUsd > 0) out.push('spend');
  return out;
}

/** Info reviews the router approves under this draft stay approved. */
export function grantsFinalReviews(draft: MandateSignInput): boolean {
  return draft.decideScopes.includes('review.info');
}
