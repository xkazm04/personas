// The mandate surfaces' token labels: every machine token the backend sends
// (status, autopilot mode, actor, decide scope, merge policy) resolved to the
// `t.monitor.ml_*` copy, never rendered raw.

import type { AutopilotMode } from '@/api/devTools/autopilot';
import type { Translations } from '@/i18n/generated/types';
import type { CharterActor } from '@/lib/bindings/CharterActor';
import type { DecideScope } from '@/lib/bindings/DecideScope';
import type { MergePolicy } from '@/lib/bindings/MergePolicy';

type M = Translations['monitor'];

export function statusLabel(m: M, status: string): string {
  switch (status) {
    case 'draft': return m.ml_status_draft;
    case 'suspended': return m.ml_status_suspended;
    case 'active': return m.ml_status_active;
    default: return status;
  }
}

/** `null` is an unset mode, which the cockpit renders as off. */
export function modeLabel(m: M, mode: AutopilotMode | null): string {
  switch (mode) {
    case 'measure': return m.ml_steward_mode_measure;
    case 'suggest': return m.ml_steward_mode_suggest;
    case 'full': return m.ml_steward_mode_full;
    default: return m.ml_steward_mode_off;
  }
}

export function actorLabel(m: M, actor: CharterActor): string {
  switch (actor) {
    case 'router': return m.ml_actor_router;
    case 'steward': return m.ml_actor_steward;
    case 'operator': return m.ml_actor_operator;
  }
}

export function scopeLabel(m: M, scope: DecideScope): string {
  switch (scope) {
    case 'idea.accept': return m.ml_scope_idea_accept;
    case 'idea.reject': return m.ml_scope_idea_reject;
    case 'review.info': return m.ml_scope_review_info;
    case 'incident.triage': return m.ml_scope_incident_triage;
    case 'question.answer': return m.ml_scope_question_answer;
    case 'dispatch': return m.ml_scope_dispatch;
    case 'report.read': return m.ml_scope_report_read;
    case 'council.attach': return m.ml_scope_council_attach;
  }
}

export function mergeLabel(m: M, policy: MergePolicy): string {
  switch (policy) {
    case 'never': return m.ml_merge_never;
    case 'gate-green': return m.ml_merge_gate_green;
    case 'gate-green+council-ready': return m.ml_merge_council_ready;
  }
}

const SCOPES: readonly string[] = [
  'idea.accept', 'idea.reject', 'review.info', 'incident.triage',
  'question.answer', 'dispatch', 'report.read', 'council.attach',
];

/** A stored scope string narrowed to a known `DecideScope`, or null. */
export function asScope(scope: string | null): DecideScope | null {
  return scope !== null && SCOPES.includes(scope) ? (scope as DecideScope) : null;
}
