/**
 * ExecutionState -- canonical state machine for execution status.
 *
 * The Rust `ExecutionState` enum in `engine/types.rs` is the single source
 * of truth and is exported via ts_rs to `lib/bindings/ExecutionState.ts`.
 * This module re-exports that type, adds the frontend-only `'unknown'`
 * fallback, and derives the TERMINAL / ACTIVE sets so there is exactly
 * one place to update when a new variant is added.
 *
 * Valid transitions (the full map is `VALID_TRANSITIONS` below):
 *   Queued  -> Running | Failed | Cancelled
 *   Running -> Completed | Failed | Incomplete | Cancelled
 *
 * ## Why `'unknown'` is TERMINAL
 *
 * `'unknown'` is not a state the backend can emit -- it is what
 * `parseExecutionState` returns for a token this frontend does not recognise
 * (a newer backend variant, a corrupted row, a hand-edited log). It is listed
 * in `TERMINAL_STATES` on purpose, and the reason is a liveness one rather
 * than a semantic one: `isTerminalState` is the predicate that clears
 * `activeExecutionId` / `isExecuting` / the recovery key. If `'unknown'` were
 * non-terminal, an unrecognised terminal event would finalize NOTHING -- the
 * run would keep `isExecuting` pinned for up to `RUN_MAX_DURATION_MS` and
 * force every later run into background mode, which is exactly the failure
 * `execution-runner #2` describes. Treating it as terminal costs at worst an
 * early teardown of a run that was in fact still alive; treating it as active
 * costs a wedged UI with no way back. It is deliberately NOT a member of
 * `TerminalStatus`, so a caller that needs one of the four REAL outcomes
 * (chat finalize, badge mapping) still cannot silently receive it.
 */

import type { ExecutionState as RustExecutionState } from '@/lib/bindings/ExecutionState';
import { createLogger } from '@/lib/log';

const logger = createLogger('ExecutionState');

// ── Canonical type ──────────────────────────────────────────────────────
// Re-export the Rust-generated type + the frontend-only 'unknown' fallback.

/** Canonical execution state type. Matches Rust enum + frontend fallback. */
export type ExecutionState = RustExecutionState | 'unknown';

/** All valid execution states as a const tuple. */
export const EXECUTION_STATES = [
  'queued',
  'running',
  'completed',
  'failed',
  'incomplete',
  'cancelled',
  'unknown',
] as const satisfies readonly ExecutionState[];

// ── Terminal / Active sets ──────────────────────────────────────────────
// These MUST match the Rust TERMINAL / ACTIVE slices in engine/types.rs.
// A Rust compile-time test enforces the Rust side; keep these in sync.

/** Terminal states -- execution is done, no further transitions. */
export const TERMINAL_STATES: readonly ExecutionState[] = [
  'completed',
  'failed',
  'incomplete',
  'cancelled',
  'unknown',
] as const;

/** Set form for O(1) terminal-state checks (used by executionSlice). */
export const TERMINAL_STATUS_SET: ReadonlySet<string> = new Set(TERMINAL_STATES);

/** Active states -- execution is in progress. */
export const ACTIVE_STATES: readonly ExecutionState[] = [
  'queued',
  'running',
] as const;

/**
 * Returns true if the status represents an active (non-terminal) execution.
 * This replaces the separate `isExecuting` boolean -- derive it from status.
 */
export function isActiveState(status: string): boolean {
  return status === 'queued' || status === 'running';
}

/** Returns true if the status is a terminal state. */
export function isTerminalState(status: string): boolean {
  return TERMINAL_STATUS_SET.has(status);
}

/** Type guard: check if a string is a valid ExecutionState. */
export function isExecutionState(s: string): s is ExecutionState {
  return (EXECUTION_STATES as readonly string[]).includes(s);
}

/**
 * Parse an unknown string into ExecutionState, with fallback.
 * Handles the legacy "pending" alias for "queued".
 * Unrecognised values map to 'unknown' (not 'failed') so data corruption
 * is visible in the UI instead of masquerading as a real failure.
 */
export function parseExecutionState(s: string | null | undefined): ExecutionState {
  if (!s) return 'queued';
  if (s === 'pending') return 'queued';
  if (isExecutionState(s)) return s;
  logger.error(`Unknown status "${s}" — displaying as unknown`, { status: s });
  return 'unknown';
}

/**
 * Valid transition map. Key = current state, Value = allowed next states.
 */
export const VALID_TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  queued: ['running', 'failed', 'cancelled'],
  running: ['completed', 'failed', 'incomplete', 'cancelled'],
  completed: [],
  failed: [],
  incomplete: [],
  cancelled: [],
  unknown: [],
};

/** Check if a transition from `current` to `next` is valid. */
export function canTransition(current: ExecutionState, next: ExecutionState): boolean {
  return (VALID_TRANSITIONS[current] as readonly string[]).includes(next);
}

/** Terminal status type -- only the terminal subset of ExecutionState. */
export type TerminalStatus = 'completed' | 'failed' | 'cancelled' | 'incomplete';

/**
 * Every state a run can END in, including the frontend-only `'unknown'`
 * fallback.
 *
 * Distinct from `TerminalStatus` on purpose: a consumer that must branch on a
 * REAL outcome (chat finalize, the background badge's three-arm union) takes
 * `TerminalStatus` and therefore cannot be handed `'unknown'`, while a
 * consumer that merely RECORDS the outcome (the finalize_status middleware
 * payload, `finishExecution`) takes this wider type and can name the
 * corruption instead of asserting it into one of the four.
 */
export type TerminalExecutionState = TerminalStatus | 'unknown';

/**
 * Narrowing form of `isTerminalState` for an already-parsed state.
 *
 * `isTerminalState` deliberately keeps its `(status: string) => boolean`
 * signature -- it is called with raw event fields all over the app. This one
 * is the door-side guard: it turns a parsed `ExecutionState` into the
 * `TerminalExecutionState` the finalize path needs, so no caller has to
 * assert.
 */
export function isTerminalExecutionState(s: ExecutionState): s is TerminalExecutionState {
  return TERMINAL_STATUS_SET.has(s);
}
