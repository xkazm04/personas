/**
 * scopeForKind — which decide scope, once held, takes a kind out of a
 * `scope` breach. The Breach card's "Widen" amend reads it.
 *
 * This is the frontend half of the router's per-kind law under a signed
 * envelope (`route_signed_kind` and `RouterAct::scope` in
 * `src-tauri/engine/src/mandate_router.rs`). The Rust table is the authority;
 * `scopeForKind.test.ts` reads it at run time and fails the moment the two
 * disagree.
 *
 * Only the kinds a SINGLE scope releases are here. A review is not: a
 * binding review is a scope breach no scope fixes, and the card cannot tell a
 * binding review from an info one, so a review breach amends by deciding the
 * review itself. Approvals, policy and evolution proposals are never
 * delegated by any scope. React-free.
 */
import type { DecideScope } from '@/lib/bindings/DecideScope';

import type { DecisionKind } from '../model/decisionModel';

export const SCOPE_FOR_KIND: Readonly<Partial<Record<DecisionKind, DecideScope>>> = {
  idea: 'idea.accept',
  question: 'question.answer',
  incident: 'incident.triage',
};

export function scopeForKind(kind: DecisionKind): DecideScope | null {
  return SCOPE_FOR_KIND[kind] ?? null;
}
