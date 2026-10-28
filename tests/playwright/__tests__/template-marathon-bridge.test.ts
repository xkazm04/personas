// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TERMINAL_EXECUTION_STATUSES, isSettledExecutionSince, type ExecutionRow } from '../template-marathon-bridge';

/**
 * The marathon waits for a capability's execution to finish. It waited only
 * for completed|failed, so an execution that ended `incomplete` (process
 * died) or `cancelled` burned the whole 10-minute wait and was reported as
 * "execution-timeout" - the wrong verdict, ten minutes late.
 */
const ROOT = path.resolve(__dirname, '../../..');

function rustTerminalStates(): string[] {
  // Terminal = no outgoing transitions in the ExecutionState state machine.
  const src = fs.readFileSync(path.join(ROOT, 'src-tauri/core/src/types.rs'), 'utf8');
  const block = src.slice(src.indexOf('pub enum ExecutionState'), src.indexOf('aliases {', src.indexOf('pub enum ExecutionState')));
  return [...block.matchAll(/\w+\("([a-z_]+)"\)\s*=>\s*\[\s*\]/g)].map((m) => m[1]!);
}

const row = (status: string, created_at = '2026-10-20T10:00:05.000000+00:00'): ExecutionRow => ({
  id: 'x', persona_id: 'p', status, created_at,
});

describe('template-marathon waitForExecution', () => {
  it('treats exactly the backend terminal states as finished', () => {
    const rust = rustTerminalStates();
    expect(rust.length).toBeGreaterThan(0);
    expect([...TERMINAL_EXECUTION_STATUSES].sort()).toEqual([...rust].sort());
  });

  it.each(['completed', 'failed', 'incomplete', 'cancelled'])('settles on %s', (status) => {
    expect(isSettledExecutionSince(row(status), '2026-10-20T10:00:00.000Z')).toBe(true);
  });

  it.each(['queued', 'running'])('keeps waiting on %s', (status) => {
    expect(isSettledExecutionSince(row(status), '2026-10-20T10:00:00.000Z')).toBe(false);
  });

  it('ignores an execution created before the capability started', () => {
    expect(isSettledExecutionSince(row('completed', '2026-10-20T09:59:59.000000+00:00'), '2026-10-20T10:00:00.000Z')).toBe(false);
  });
});
