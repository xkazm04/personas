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

describe('isNeverAttached', () => {
  it('true for a stale session that never bound a cc id', () => {
    expect(isNeverAttached(session({ state: 'stale', claudeSessionId: null }))).toBe(true);
  });
  it('false once a cc id is bound (it attached)', () => {
    expect(isNeverAttached(session({ state: 'stale', claudeSessionId: 'cc-1' }))).toBe(false);
  });
  it('false while still spawning (normal startup, not yet a verdict)', () => {
    expect(isNeverAttached(session({ state: 'spawning', claudeSessionId: null }))).toBe(false);
  });
});

describe('sessionAttention', () => {
  it('never-attached stale → failed (red), not the amber stale that invites a nudge', () => {
    expect(sessionAttention(session({ state: 'stale', claudeSessionId: null }))).toBe('failed');
  });
  it('genuinely-stale attached session → stale', () => {
    expect(sessionAttention(session({ state: 'stale', claudeSessionId: 'cc-1' }))).toBe('stale');
  });
  it('awaiting_input → waiting', () => {
    expect(sessionAttention(session({ state: 'awaiting_input', claudeSessionId: 'cc-1' }))).toBe('waiting');
  });
});

describe('craftStalePrompt', () => {
  it('never-attached → tells Athena NOT to propose fleet_send_input', () => {
    const p = craftStalePrompt(session({ state: 'stale', claudeSessionId: null }));
    expect(p).toContain('never attached');
    expect(p).toMatch(/do NOT propose fleet_send_input/i);
  });
  it('real stale → asks for a fleet_send_input proposal', () => {
    const p = craftStalePrompt(session({ state: 'stale', claudeSessionId: 'cc-1' }));
    expect(p).toContain('fleet_send_input');
    expect(p).not.toContain('never attached');
  });
});
