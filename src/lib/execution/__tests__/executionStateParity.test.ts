// @vitest-environment node
/**
 * THE TS STATE MACHINE IS A MIRROR OF THE RUST ONE, SO IT IS READ AGAINST IT.
 *
 * `executionState.ts` says its TERMINAL / ACTIVE sets "MUST match the Rust
 * TERMINAL / ACTIVE slices" and that "a Rust compile-time test enforces the
 * Rust side; keep these in sync". The Rust test proves only that the Rust
 * slices cover the Rust enum; nothing compared either side to the other, and
 * the ts-rs binding carries the variant names but neither the transitions nor
 * the terminal set. This reads `src-tauri/core/src/types.rs` itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TERMINAL_STATES, ACTIVE_STATES, VALID_TRANSITIONS } from '../executionState';

const RUST = readFileSync(resolve(__dirname, '../../../../src-tauri/core/src/types.rs'), 'utf8')
  // Comments out first, so a doc line that names a variant cannot match.
  .replace(/\/\/[^\n]*/g, '');

const snake = (v: string) => v.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();

function rustEnumBlock(): string {
  const m = RUST.match(/pub enum ExecutionState, entity = "execution" \{([\s\S]*?)\n\s*\}/);
  if (!m) throw new Error('ExecutionState state-machine block not found in types.rs');
  return m[1]!;
}

function rustTransitions(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of rustEnumBlock().matchAll(/\w+\("([a-z_]+)"\)\s*=>\s*\[([^\]]*)\]/g)) {
    out[m[1]!] = m[2]!.split(',').map((s) => s.trim()).filter(Boolean).map(snake);
  }
  return out;
}

function rustSlice(name: 'TERMINAL' | 'ACTIVE'): string[] {
  const m = RUST.match(new RegExp(`pub const ${name}: &'static \\[ExecutionState\\] =\\s*&\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`ExecutionState::${name} not found in types.rs`);
  return [...m[1]!.matchAll(/ExecutionState::(\w+)/g)].map((v) => snake(v[1]!));
}

describe('ExecutionState TS <-> Rust parity', () => {
  it('reads a non-empty machine from the Rust source (the probe itself works)', () => {
    expect(Object.keys(rustTransitions()).length).toBeGreaterThanOrEqual(6);
  });

  it('every Rust state has the same outgoing edges in VALID_TRANSITIONS', () => {
    const rust = rustTransitions();
    for (const [state, next] of Object.entries(rust)) {
      expect([...(VALID_TRANSITIONS[state as keyof typeof VALID_TRANSITIONS] ?? ['<missing>'])].sort(), state)
        .toEqual([...next].sort());
    }
    // ...and TS declares no backend state Rust lacks ('unknown' is TS-only).
    const tsBackendStates = Object.keys(VALID_TRANSITIONS).filter((s) => s !== 'unknown').sort();
    expect(tsBackendStates).toEqual(Object.keys(rust).sort());
  });

  it('TERMINAL and ACTIVE match the Rust slices', () => {
    expect(TERMINAL_STATES.filter((s) => s !== 'unknown').slice().sort()).toEqual(rustSlice('TERMINAL').sort());
    expect([...ACTIVE_STATES].sort()).toEqual(rustSlice('ACTIVE').sort());
  });
});
