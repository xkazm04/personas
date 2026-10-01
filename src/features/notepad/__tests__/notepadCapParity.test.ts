import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NOTE_STATUS_META, noteOccupiesSlot } from '../noteStatusMeta';

// GATE OVER THE ARTIFACT. The pad's "ten notes open" cap is one rule written
// twice: `count_active_notes` in Rust (what the server REFUSES on) and
// `noteOccupiesSlot` here (what greys the `+` button out). The cap tests in
// notepadStore.test.ts hand-list the five live statuses, so they read the
// implementation's own idea of the rule — add `completed` to the Rust list and
// they stay green while the pad starts accepting notes the server rejects.
// This one parses the Rust const at run time instead of holding a copy of it.
//
// Negative controls (run 2026-10-01, restored): adding 'completed' to
// noteOccupiesSlot fails the parity test; dropping 'cut' from ACTIVE_STATUSES
// fails it the other way.
const NOTES_RS = resolve(__dirname, '../../../../src-tauri/db/src/repos/dev/notes.rs');

function rustActiveStatuses(): string[] {
  const src = readFileSync(NOTES_RS, 'utf8');
  const decl = src.match(/const ACTIVE_STATUSES: &str = "([^"]*)";/);
  if (!decl) throw new Error(`No 'const ACTIVE_STATUSES' in ${NOTES_RS}`);
  return [...decl[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('the pad cap <-> count_active_notes parity', () => {
  it('finds the Rust status list it claims to gate', () => {
    // failure-not-empty-success: a parse that matched nothing must not report clean.
    expect(rustActiveStatuses().length).toBeGreaterThan(0);
  });

  it('counts exactly the statuses the server counts', () => {
    const pad = Object.keys(NOTE_STATUS_META).filter((s) => noteOccupiesSlot(s as keyof typeof NOTE_STATUS_META));
    expect(pad.sort()).toEqual([...rustActiveStatuses()].sort());
  });
});
