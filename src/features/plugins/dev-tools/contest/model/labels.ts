// Machine tokens → translated labels and status tones.
//
// The backend sends closed vocabularies (phase, seat state, chain step,
// bucket, problem code). Each is resolved here, in one switch per vocabulary,
// so no component authors a label next to its colour and a new wire value is
// a compile error (the `never` arms), not a blank chip.
import type { Translations } from '@/i18n/generated/types';
import type { ContestEffort } from '@/lib/bindings/ContestEffort';
import type { ContestEngine } from '@/lib/bindings/ContestEngine';
import type { ContestPhase } from '@/lib/bindings/ContestPhase';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestSeatKind } from '@/lib/bindings/ContestSeatKind';
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';
import type { ContestStep } from '@/lib/bindings/ContestStep';
import type { StatusVariant } from '@/features/shared/components/display/StatusBadge';

import type { SetupIssue } from './setupValidation';

export type ContestStrings = Translations['plugins']['contest'];

type Tx = (template: string, vars: Record<string, string | number>) => string;

export function phaseLabel(s: ContestStrings, phase: ContestPhase): string {
  switch (phase) {
    case 'draft': return s.phase_draft;
    case 'queued': return s.phase_queued;
    case 'running': return s.phase_running;
    case 'collecting': return s.phase_collecting;
    case 'judging': return s.phase_judging;
    case 'review': return s.phase_review;
    case 'shortlisted': return s.phase_shortlisted;
    case 'decided': return s.phase_decided;
    case 'failed': return s.phase_failed;
    default: return unknownLabel(phase);
  }
}

export function phaseTone(phase: ContestPhase): StatusVariant {
  switch (phase) {
    case 'draft': return 'neutral';
    case 'queued': return 'info';
    case 'running':
    case 'collecting':
    case 'judging': return 'processing';
    case 'review':
    case 'shortlisted': return 'warning';
    case 'decided': return 'success';
    case 'failed': return 'error';
    default: return unknownTone(phase);
  }
}

export function seatStateTone(state: ContestSeatState): StatusVariant {
  switch (state) {
    case 'idle': return 'neutral';
    case 'queued': return 'info';
    case 'running': return 'processing';
    case 'completed': return 'success';
    case 'seat-limit':
    case 'timed-out': return 'warning';
    case 'errored': return 'error';
    default: return unknownTone(state);
  }
}

/** Seats a rerun makes sense for: the run ended without a clean finish. */
export function isRerunnable(state: ContestSeatState): boolean {
  return state === 'seat-limit' || state === 'timed-out' || state === 'errored';
}

/** Whether a lane rerun is offered in this phase. A participant launch resets
 *  the chain to idle, so after the verdict (decided, shortlisted) it would spend
 *  a paid seat and re-arm collect on a decided arena, and mid-chain (collecting,
 *  judging) it would pull the chain out from under the stewards. A judge seat
 *  may be rerun while the stewards judge. */
export function canRerun(phase: ContestPhase, kind: ContestSeatKind): boolean {
  switch (phase) {
    case 'decided':
    case 'shortlisted':
    case 'collecting': return false;
    case 'judging': return kind === 'judge';
    default: return true;
  }
}

export function stepLabel(s: ContestStrings, step: ContestStep): string {
  switch (step) {
    case 'collect': return s.step_collect;
    case 'visual': return s.step_visual;
    case 'judge': return s.step_judge;
    case 'aggregate': return s.step_aggregate;
    default: return unknownLabel(step);
  }
}

export function bucketLabel(s: ContestStrings, bucket: ContestReviewBucket): string {
  switch (bucket) {
    case 'failure': return s.bucket_failure;
    case 'impractical': return s.bucket_impractical;
    case 'shortlist': return s.bucket_shortlist;
    case 'winner': return s.bucket_winner;
    default: return unknownLabel(bucket);
  }
}

export function bucketTone(bucket: ContestReviewBucket): StatusVariant {
  switch (bucket) {
    case 'failure': return 'error';
    case 'impractical': return 'warning';
    case 'shortlist': return 'info';
    case 'winner': return 'success';
    default: return unknownTone(bucket);
  }
}

export function engineLabel(s: ContestStrings, engine: ContestEngine): string {
  switch (engine) {
    case 'claude': return s.engine_claude;
    case 'codex': return s.engine_codex;
    case 'grok': return s.engine_grok;
    default: return unknownLabel(engine);
  }
}

export function effortLabel(s: ContestStrings, effort: ContestEffort): string {
  switch (effort) {
    case 'low': return s.effort_low;
    case 'medium': return s.effort_medium;
    case 'high': return s.effort_high;
    case 'xhigh': return s.effort_xhigh;
    case 'max': return s.effort_max;
    default: return unknownLabel(effort);
  }
}

/** A readiness problem CODE (ContestEnvironment.problems) → a sentence. */
export function problemLabel(s: ContestStrings, code: string, tx: Tx): string {
  switch (code) {
    case 'node-missing': return s.problem_node_missing;
    case 'instrument-missing': return s.problem_instrument_missing;
    case 'playwright-missing': return s.problem_playwright_missing;
    case 'claude-missing': return s.problem_claude_missing;
    case 'codex-missing': return s.problem_codex_missing;
    case 'grok-missing': return s.problem_grok_missing;
    default: return tx(s.problem_unknown, { code });
  }
}

/** Blocking problems stop a run; the rest only degrade it (no screenshots). */
export function isBlockingProblem(code: string): boolean {
  return code !== 'playwright-missing';
}

export function setupIssueLabel(s: ContestStrings, issue: SetupIssue, tx: Tx): string {
  const ids = (issue.ids ?? []).join(', ');
  switch (issue.code) {
    case 'title-missing': return s.issue_title_missing;
    case 'project-missing': return s.issue_project_missing;
    case 'brief-missing': return s.issue_brief_missing;
    case 'seats-missing': return s.issue_seats_missing;
    case 'seats-duplicate': return tx(s.issue_seats_duplicate, { ids });
    case 'seat-token-invalid': return s.issue_seat_token_invalid;
    case 'variants-range': return s.issue_variants_range;
    case 'timeout-range': return s.issue_timeout_range;
    case 'judges-missing': return s.issue_judges_missing;
    case 'judges-duplicate': return tx(s.issue_judges_duplicate, { ids });
    case 'start-in-past': return s.issue_start_in_past;
    default: return unknownLabel(issue.code);
  }
}

/** A wire value this build does not know yet (a newer backend): show the raw
 *  token rather than crash. The `never` parameter still makes a MISSING arm a
 *  compile error. */
function unknownLabel(v: never): string {
  return String(v);
}

function unknownTone(_v: never): StatusVariant {
  return 'neutral';
}

export type ArenaStrings = ContestStrings['arena'];

/** A seat's life in the Arena's race words (`On the grid`, `Racing`, …). */
export function laneStateLabel(a: ArenaStrings, state: ContestSeatState): string {
  switch (state) {
    case 'idle': return a.lane_state.idle;
    case 'queued': return a.lane_state.queued;
    case 'running': return a.lane_state.running;
    case 'completed': return a.lane_state.completed;
    case 'seat-limit': return a.lane_state.seat_limit;
    case 'timed-out': return a.lane_state.timed_out;
    case 'errored': return a.lane_state.errored;
    default: return unknownLabel(state);
  }
}
