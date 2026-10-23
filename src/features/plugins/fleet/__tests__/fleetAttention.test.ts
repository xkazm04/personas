// Reads the Rust ticker's source with node:fs (the parity block below); tsc
// skips __tests__/.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// `isNeverAttached` prefix-matches prose the Rust stale ticker writes
// (`stale.rs`, the `stale:never-attached` transition). The fixture above is a
// hand copy of it, so a reworded Rust reason left every test here green while
// the never-attached strip silently stopped appearing. Read the real string.
describe('never-attached reason parity with the Rust ticker', () => {
  function rustNeverAttachedReasons(): string[] {
    const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/commands/fleet/stale.rs'), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const reasons: string[] = [];
    // The reason literal bound right before the transition tagged never-attached.
    const re = /let\s+reason\s*=\s*"([^"]+)";(?:(?!let\s+reason)[\s\S]){0,400}?"stale:never-attached"/g;
    for (const m of src.matchAll(re)) reasons.push(m[1]!);
    return reasons;
  }

  it('finds the reason in the Rust source (a matcher that finds nothing is broken)', () => {
    expect(rustNeverAttachedReasons().length).toBeGreaterThan(0);
  });

  it('classifies every reason the ticker can write as never-attached', () => {
    for (const reason of rustNeverAttachedReasons()) {
      expect(isNeverAttached(session({ state: 'stale', stateReason: reason }))).toBe(true);
    }
  });

  it('keeps the test fixture identical to what Rust writes', () => {
    expect(rustNeverAttachedReasons()).toContain(NEVER_ATTACHED);
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
