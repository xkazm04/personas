import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WINDOW_MS } from '../LlmCallsTable';

// The Calls table filters rows that `list_all_executions` already cut at a
// server-side window. A client window wider than that cut (it had an "All"
// tab, Infinity) shows the same rows as the widest real one under a label that
// claims the whole history. Tethered to the Rust constant, so moving the cut
// fails here instead of silently re-opening the gap.

function serverWindowDays(): number {
  const src = readFileSync(
    resolve(__dirname, '../../../../../../src-tauri/src/commands/execution/executions.rs'),
    'utf8',
  );
  const m = src.match(/const ACTIVITY_LIST_WINDOW_DAYS:\s*i64\s*=\s*(\d+);/);
  if (!m) throw new Error('ACTIVITY_LIST_WINDOW_DAYS not found in executions.rs');
  return Number(m[1]);
}

describe('LlmCallsTable time windows', () => {
  it('offers no window wider than the server-side list cut', () => {
    const capMs = serverWindowDays() * 24 * 60 * 60 * 1000;
    for (const [id, ms] of Object.entries(WINDOW_MS)) {
      expect({ id, withinCut: ms <= capMs }).toEqual({ id, withinCut: true });
    }
  });

  it('its widest window is the server cut itself', () => {
    expect(Math.max(...Object.values(WINDOW_MS))).toBe(serverWindowDays() * 24 * 60 * 60 * 1000);
  });
});
