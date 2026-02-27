/**
 * ExecutionState — canonical state machine for execution status.
 *
 * Mirrors the Rust `ExecutionState` enum in `engine/types.rs`.
 * All status comparisons, color mappings, and boolean derivations
 * should go through this module instead of raw string comparisons.
 *
 * Valid transitions:
 *   Queued -> Running
 *   Running -> Completed | Failed | Incomplete | Cancelled
 */

/** All valid execution states as a const tuple. */
export const EXECUTION_STATES = [
  'queued',
  'running',
  'completed',
  'failed',
  'incomplete',
  'cancelled',
] as const;

/** Canonical execution state type (matches Rust enum serialization). */
export type ExecutionState = (typeof EXECUTION_STATES)[number];

/** Terminal states — execution is done, no further transitions. */
export const TERMINAL_STATES: readonly ExecutionState[] = [
  'completed',
  'failed',
  'incomplete',
  'cancelled',
] as const;

/** Active states — execution is in progress. */
export const ACTIVE_STATES: readonly ExecutionState[] = [
  'queued',
  'running',
] as const;

/**
 * Returns true if the status represents an active (non-terminal) execution.
 * This replaces the separate `isExecuting` boolean — derive it from status.
 */
export function isActiveState(status: string): boolean {
  return status === 'queued' || status === 'running';
}

/** Returns true if the status is a terminal state. */
export function isTerminalState(status: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(status);
}

/** Type guard: check if a string is a valid ExecutionState. */
export function isExecutionState(s: string): s is ExecutionState {
  return (EXECUTION_STATES as readonly string[]).includes(s);
}

/**
 * Parse an unknown string into ExecutionState, with fallback.
 * Handles the legacy "pending" alias for "queued".
 */
export function parseExecutionState(s: string | null | undefined): ExecutionState {
  if (!s) return 'queued';
  if (s === 'pending') return 'queued';
  if (isExecutionState(s)) return s;
  return 'failed'; // Unknown states treated as failed
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
};

/** Check if a transition from `current` to `next` is valid. */
export function canTransition(current: ExecutionState, next: ExecutionState): boolean {
  return (VALID_TRANSITIONS[current] as readonly string[]).includes(next);
}
