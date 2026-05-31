import { describe, it, expect } from 'vitest';
import { sessionAttention, isNeverAttached, craftStalePrompt } from '../fleetAttention';
import type { FleetSession } from '@/lib/bindings/FleetSession';

function session(over: Partial<FleetSession>): FleetSession {
  return {
    id: 's1',
    claudeSessionId: null,
    cwd: 'C:/Users/x/ascent',
    projectLabel: 'ascent',
    name: null,
    args: [],
    state: 'spawning',
    lastActivityMs: 0n,
    createdAtMs: 0n,
    childPid: null,
    exitCode: null,
    stateReason: null,
    ...over,
  } as FleetSession;
}

const NEVER_ATTACHED = 'Claude never attached — the folder may need trust approval, or claude failed to start. Safe to kill.';

describe('isNeverAttached', () => {
  it('true only on the Rust never-attached reason verdict', () => {
    expect(isNeverAttached(session({ state: 'stale', stateReason: NEVER_ATTACHED }))).toBe(true);
  });
  it('false for a generic-stale session even with no cc id bound', () => {
    // The reported regression: cc:- + "No log growth" must NOT read as never-attached.
    expect(
      isNeverAttached(session({ state: 'stale', claudeSessionId: null, stateReason: 'No log growth for 6 min' })),
    ).toBe(false);
  });
  it('false when there is no reason at all', () => {
    expect(isNeverAttached(session({ state: 'stale', stateReason: null }))).toBe(false);
  });
});

describe('sessionAttention', () => {
  it('stale stays amber (never red) — including never-attached, so real state shows', () => {
    expect(sessionAttention(session({ state: 'stale', stateReason: NEVER_ATTACHED }))).toBe('stale');
    expect(sessionAttention(session({ state: 'stale', stateReason: 'No log growth for 6 min' }))).toBe('stale');
  });
  it('only a non-zero exit is failed (red)', () => {
    expect(sessionAttention(session({ state: 'exited', exitCode: 1 }))).toBe('failed');
    expect(sessionAttention(session({ state: 'exited', exitCode: 0 }))).toBe('none');
  });
  it('awaiting_input → waiting', () => {
    expect(sessionAttention(session({ state: 'awaiting_input' }))).toBe('waiting');
  });
});

describe('craftStalePrompt', () => {
  it('never-attached (by reason) → tells Athena NOT to propose fleet_send_input', () => {
    const p = craftStalePrompt(session({ state: 'stale', stateReason: NEVER_ATTACHED }));
    expect(p).toContain('never attached');
    expect(p).toMatch(/do NOT propose fleet_send_input/i);
  });
  it('generic stale → asks for a fleet_send_input proposal', () => {
    const p = craftStalePrompt(session({ state: 'stale', stateReason: 'No log growth for 6 min' }));
    expect(p).toContain('fleet_send_input');
    expect(p).not.toContain('never attached');
  });
});
