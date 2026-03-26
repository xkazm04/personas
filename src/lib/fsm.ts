/**
 * Universal finite state machine framework.
 *
 * Provides `createFSM()` to declare a state machine from a transition table,
 * and `useFSM()` to drive it from React components.
 *
 * ## Usage
 *
 * ```ts
 * const designFSM = createFSM({
 *   entity: 'design',
 *   transitions: {
 *     idle:      ['analyzing'],
 *     analyzing: ['preview', 'error', 'awaiting-input'],
 *     preview:   ['applying', 'refining'],
 *     // ...
 *   },
 * });
 *
 * // Validate a transition
 * designFSM.canTransition('idle', 'analyzing'); // true
 * designFSM.canTransition('idle', 'preview');   // false
 *
 * // Enforce a transition (throws on invalid)
 * designFSM.transition('idle', 'analyzing'); // 'analyzing'
 * designFSM.transition('idle', 'preview');   // throws InvalidTransitionError
 * ```
 */

import { createLogger } from '@/lib/log';

const logger = createLogger('fsm');

// =============================================================================
// Error type
// =============================================================================

export class InvalidTransitionError extends Error {
  readonly entity: string;
  readonly from: string;
  readonly to: string;

  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} transition: '${from}' -> '${to}'`);
    this.name = 'InvalidTransitionError';
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

// =============================================================================
// Core types
// =============================================================================

/** A transition table maps each state to the set of states it can reach. */
export type TransitionTable<S extends string> = Record<S, readonly S[]>;

/** Definition for creating an FSM. */
export interface FSMDefinition<S extends string> {
  /** Entity name for error messages (e.g. "trigger", "design"). */
  entity: string;
  /** Map from each state to its allowed target states. */
  transitions: TransitionTable<S>;
}

/** A created FSM instance with validation and transition methods. */
export interface FSM<S extends string> {
  /** Entity name. */
  readonly entity: string;
  /** All states in the FSM. */
  readonly states: readonly S[];
  /** The raw transition table. */
  readonly transitions: Readonly<TransitionTable<S>>;
  /** Check whether a transition from `from` to `to` is valid. */
  canTransition(from: S, to: S): boolean;
  /**
   * Attempt a transition. Returns `to` if valid, throws `InvalidTransitionError` if not.
   * Same-state transitions are always allowed (no-op).
   */
  transition(from: S, to: S): S;
  /**
   * Like `transition` but returns `null` instead of throwing on invalid transitions.
   * Logs a warning for invalid transitions.
   */
  tryTransition(from: S, to: S): S | null;
  /** Get all states reachable from `from`. */
  reachableFrom(from: S): readonly S[];
  /** Check if a state is terminal (no outgoing transitions). */
  isTerminal(state: S): boolean;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an FSM instance from a definition.
 *
 * The returned object is immutable and can be shared across the application.
 * The transition table is pre-compiled into Sets for O(1) lookups.
 */
export function createFSM<S extends string>(def: FSMDefinition<S>): FSM<S> {
  const { entity, transitions } = def;
  const states = Object.keys(transitions) as S[];

  // Pre-compile to Sets for fast lookup
  const transitionSets = {} as Record<S, ReadonlySet<S>>;
  for (const state of states) {
    transitionSets[state] = new Set(transitions[state]);
  }

  const fsm: FSM<S> = {
    entity,
    states,
    transitions,

    canTransition(from: S, to: S): boolean {
      if (from === to) return true;
      return transitionSets[from]?.has(to) ?? false;
    },

    transition(from: S, to: S): S {
      if (from === to) return from;
      if (transitionSets[from]?.has(to)) return to;
      throw new InvalidTransitionError(entity, from, to);
    },

    tryTransition(from: S, to: S): S | null {
      if (from === to) return from;
      if (transitionSets[from]?.has(to)) return to;
      logger.warn('Invalid transition', { entity, from, to });
      return null;
    },

    reachableFrom(from: S): readonly S[] {
      return transitions[from] ?? [];
    },

    isTerminal(state: S): boolean {
      const targets = transitions[state];
      return !targets || targets.length === 0;
    },
  };

  return fsm;
}

// =============================================================================
// React reducer integration
// =============================================================================

/**
 * Options for creating an FSM reducer.
 */
export interface FSMReducerOptions<S extends string, A extends { type: string }> {
  /** The FSM definition to enforce. */
  fsm: FSM<S>;
  /** Extract the target state from an action. */
  actionToState: (action: A, currentState: S) => S;
}

/**
 * Create a reducer function that enforces FSM transitions.
 *
 * Invalid transitions are silently ignored (state unchanged) with a warning log.
 * This is useful for `useReducer` or Zustand store slices.
 */
export function createFSMReducer<S extends string, A extends { type: string }>(
  opts: FSMReducerOptions<S, A>,
): (state: S, action: A) => S {
  const { fsm, actionToState } = opts;

  return (state: S, action: A): S => {
    const target = actionToState(action, state);
    return fsm.tryTransition(state, target) ?? state;
  };
}

// =============================================================================
// Pre-built FSM definitions for the codebase
// =============================================================================

/** Design phase FSM -- governs the persona design analysis flow. */
export type DesignPhaseState = 'idle' | 'analyzing' | 'preview' | 'applying' | 'applied' | 'refining' | 'awaiting-input' | 'error';

export const designPhaseFSM = createFSM<DesignPhaseState>({
  entity: 'design',
  transitions: {
    'idle':           ['analyzing'],
    'analyzing':      ['preview', 'error', 'awaiting-input'],
    'preview':        ['applying', 'refining', 'idle'],
    'applying':       ['applied', 'error', 'preview'],
    'applied':        ['idle'],
    'refining':       ['preview', 'error'],
    'awaiting-input': ['analyzing'],
    'error':          ['idle', 'analyzing'],
  },
});

/** Execution status FSM -- governs persona execution lifecycle. */
export type ExecutionStatusState = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'error';

export const executionStatusFSM = createFSM<ExecutionStatusState>({
  entity: 'execution',
  transitions: {
    'pending':   ['queued', 'running', 'cancelled', 'error'],
    'queued':    ['running', 'cancelled', 'error'],
    'running':   ['completed', 'failed', 'cancelled', 'timed_out', 'error'],
    'completed': [],
    'failed':    [],
    'cancelled': [],
    'timed_out': [],
    'error':     [],
  },
});

/** Run lifecycle FSM -- governs isRunning state for execution/test/lab slices. */
export type RunLifecycleState = 'idle' | 'running' | 'failed' | 'cancelled' | 'finished' | 'timed_out';

export const runLifecycleFSM = createFSM<RunLifecycleState>({
  entity: 'run',
  transitions: {
    'idle':      ['running'],
    'running':   ['failed', 'cancelled', 'finished', 'timed_out'],
    'failed':    ['idle', 'running'],
    'cancelled': ['idle', 'running'],
    'finished':  ['idle', 'running'],
    'timed_out': ['idle', 'running'],
  },
});

/** Credential design phase FSM. */
export type CredentialDesignPhaseState = 'idle' | 'analyzing' | 'preview' | 'saving' | 'done' | 'error';

export const credentialDesignFSM = createFSM<CredentialDesignPhaseState>({
  entity: 'credential-design',
  transitions: {
    'idle':      ['analyzing'],
    'analyzing': ['preview', 'error'],
    'preview':   ['saving', 'idle', 'analyzing'],
    'saving':    ['done', 'error'],
    'done':      ['idle'],
    'error':     ['idle', 'analyzing'],
  },
});

/** Automation design phase FSM. */
export type AutomationDesignPhaseState = 'idle' | 'analyzing' | 'preview' | 'error';

export const automationDesignFSM = createFSM<AutomationDesignPhaseState>({
  entity: 'automation-design',
  transitions: {
    'idle':      ['analyzing'],
    'analyzing': ['preview', 'error'],
    'preview':   ['idle', 'analyzing'],
    'error':     ['idle', 'analyzing'],
  },
});
