/**
 * THE STATE MACHINE IS LOAD-BEARING NOW, SO IT IS TESTED.
 *
 * `executionState.ts` has held a full transition map, an active/terminal
 * partition and a parser since it was written, and until this change NONE of
 * `EXECUTION_STATES`, `TERMINAL_STATES`, `ACTIVE_STATES`, `isActiveState`,
 * `isExecutionState`, `VALID_TRANSITIONS` or `canTransition` had a single
 * consumer OR a single test. The live status event was validated as a bare
 * string and asserted into the closed union at the finalize door, so the
 * machine described a discipline nothing enforced.
 *
 * These tests pin the four properties the door now depends on:
 *  1. the legacy `pending` -> `queued` alias (backend rows predating the rename);
 *  2. an unrecognised token is NAMED once as `unknown`, never coerced to a real
 *     outcome — and it logs, exactly once, so corruption is visible;
 *  3. every declared edge in `VALID_TRANSITIONS` is accepted by `canTransition`;
 *  4. every edge NOT declared is rejected — including the terminal-to-anything
 *     edges, which is what makes a duplicate/late terminal event reportable.
 *
 * Plus the partition invariant the docblock asserts in prose: TERMINAL and
 * ACTIVE together cover EXECUTION_STATES exactly once.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import {
  ACTIVE_STATES,
  EXECUTION_STATES,
  TERMINAL_STATES,
  TERMINAL_STATUS_SET,
  canTransition,
  isActiveState,
  isExecutionState,
  isTerminalExecutionState,
  isTerminalState,
  parseExecutionState,
  VALID_TRANSITIONS,
  type ExecutionState,
} from '../executionState';

beforeEach(() => {
  logError.mockReset();
});

describe('parseExecutionState', () => {
  it('maps the legacy "pending" alias onto queued', () => {
    expect(parseExecutionState('pending')).toBe('queued');
    // The alias is a rename, not corruption — it must not log.
    expect(logError).not.toHaveBeenCalled();
  });

  it('defaults an absent status to queued without logging', () => {
    expect(parseExecutionState(null)).toBe('queued');
    expect(parseExecutionState(undefined)).toBe('queued');
    expect(parseExecutionState('')).toBe('queued');
    expect(logError).not.toHaveBeenCalled();
  });

  it('passes every canonical state through untouched', () => {
    for (const s of EXECUTION_STATES) {
      expect(parseExecutionState(s)).toBe(s);
    }
    expect(logError).not.toHaveBeenCalled();
  });

  it('names an unknown token once and yields "unknown" — never a real outcome', () => {
    expect(parseExecutionState('exploded')).toBe('unknown');
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toContain('exploded');
    // The whole point of the fallback: corruption must not masquerade as a
    // genuine failure, which is what a `?? 'failed'` default would have done.
    expect(parseExecutionState('exploded')).not.toBe('failed');
  });

  it('is case- and whitespace-sensitive — a near-miss is corruption, not a state', () => {
    expect(parseExecutionState('Completed')).toBe('unknown');
    expect(parseExecutionState(' running')).toBe('unknown');
  });
});

describe('the state partition', () => {
  it('TERMINAL and ACTIVE cover EXECUTION_STATES exactly once', () => {
    const union = [...TERMINAL_STATES, ...ACTIVE_STATES].sort();
    expect(union).toEqual([...EXECUTION_STATES].sort());
    expect(new Set(union).size).toBe(union.length);
  });

  it('isTerminalState / isActiveState agree with the sets', () => {
    for (const s of EXECUTION_STATES) {
      expect(isTerminalState(s)).toBe(TERMINAL_STATES.includes(s));
      expect(isActiveState(s)).toBe(ACTIVE_STATES.includes(s));
    }
  });

  it('"unknown" is terminal — an unrecognised terminal event must still finalize', () => {
    expect(TERMINAL_STATUS_SET.has('unknown')).toBe(true);
    expect(isTerminalExecutionState('unknown')).toBe(true);
    // ...but it is not one of the four REAL outcomes, so a consumer typed on
    // `TerminalStatus` still cannot receive it.
    expect(isTerminalExecutionState('running')).toBe(false);
    expect(isTerminalExecutionState('queued')).toBe(false);
  });

  it('isExecutionState rejects anything outside the union', () => {
    expect(isExecutionState('running')).toBe(true);
    expect(isExecutionState('pending')).toBe(false); // an alias is not a state
    expect(isExecutionState('')).toBe(false);
  });
});

describe('canTransition', () => {
  it('accepts every edge VALID_TRANSITIONS declares', () => {
    const edges: [ExecutionState, ExecutionState][] = [];
    for (const from of EXECUTION_STATES) {
      for (const to of VALID_TRANSITIONS[from]) {
        edges.push([from, to]);
        expect(canTransition(from, to)).toBe(true);
      }
    }
    // Guard the guard: a map that declared nothing would pass the loop above
    // vacuously. queued has 3 exits, running has 4.
    expect(edges).toHaveLength(7);
  });

  it('rejects every edge it does not declare', () => {
    for (const from of EXECUTION_STATES) {
      const allowed = new Set<string>(VALID_TRANSITIONS[from]);
      for (const to of EXECUTION_STATES) {
        if (allowed.has(to)) continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('reports the illegal edges the finalize door actually meets', () => {
    // A late/duplicated terminal for a run already finished.
    expect(canTransition('completed', 'completed')).toBe(false);
    // A backend that resumes a run the frontend already tore down.
    expect(canTransition('completed', 'running')).toBe(false);
    // A queue-position event after the run started.
    expect(canTransition('running', 'queued')).toBe(false);
    // Corruption arriving mid-run.
    expect(canTransition('running', 'unknown')).toBe(false);
    // Every terminal state is a sink.
    for (const t of TERMINAL_STATES) {
      expect(VALID_TRANSITIONS[t]).toEqual([]);
    }
  });

  it('accepts the two happy paths end to end', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    // ...and the abandonment path a dead process produces.
    expect(canTransition('running', 'incomplete')).toBe(true);
  });
});
