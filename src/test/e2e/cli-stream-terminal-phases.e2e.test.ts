/**
 * E2E: useCorrelatedCliStream -- the terminal phases the hook used to drop.
 *
 * Before the phase vocabulary was completed, the status listener read:
 *
 *   if (status === 'running' || status === 'completed' || status === 'failed')
 *     setPhase(status);
 *
 * Every other status the backend can emit (`cancelled`, `incomplete`,
 * `queued`, and anything unrecognised) fell through that `if`, so the phase
 * stayed `running` forever and every consumer -- the n8n transform/test
 * wizards, the query debugger, the background template preview, every
 * `CliOutputPanel` -- kept spinning on a run that had already stopped.
 *
 * One test per previously-dropped status, plus the derivation helpers the
 * consumers switch on.
 *
 * Run: `npm test -- src/test/e2e/cli-stream-terminal-phases.e2e.test.ts`
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useCorrelatedCliStream,
  toCliRunPhase,
  isCliRunActive,
  isCliRunSettled,
  isCliRunUnsuccessful,
  type CliRunPhase,
} from '@/hooks/execution/useCorrelatedCliStream';
import { EXECUTION_STATES } from '@/lib/execution/executionState';
import {
  installTauriEventEmitter,
  emitTauriEvent,
  teardownTauriEventEmitter,
} from '../helpers/tauriEventEmitter';

beforeEach(() => {
  installTauriEventEmitter();
});

afterEach(() => {
  teardownTauriEventEmitter();
  vi.restoreAllMocks();
});

/** Start a stream and deliver one status event to it. */
async function runWithStatus(status: unknown, onFailed?: (msg: string) => void) {
  const { result } = renderHook(() =>
    useCorrelatedCliStream({
      outputEvent: 'exec-output',
      statusEvent: 'exec-status',
      idField: 'execution_id',
      ...(onFailed ? { onFailed } : {}),
    }),
  );

  await act(async () => {
    await result.current.start('exec-001');
  });
  expect(result.current.phase).toBe('running');

  act(() => {
    emitTauriEvent('exec-status', { execution_id: 'exec-001', status });
  });

  return result;
}

// ===========================================================================
// 1. One test per previously-dropped status
// ===========================================================================

describe('E2E: useCorrelatedCliStream -- previously dropped statuses', () => {
  it('a cancelled run leaves `running` (it used to spin forever)', async () => {
    const result = await runWithStatus('cancelled');
    expect(result.current.phase).toBe('cancelled');
    expect(isCliRunSettled(result.current.phase)).toBe(true);
  });

  it('an incomplete run leaves `running`', async () => {
    const result = await runWithStatus('incomplete');
    expect(result.current.phase).toBe('incomplete');
    expect(isCliRunSettled(result.current.phase)).toBe(true);
  });

  it('a queued status is surfaced as its own non-spinning phase', async () => {
    const result = await runWithStatus('queued');
    expect(result.current.phase).toBe('queued');
    // Active (more may still happen) but NOT settled -- consumers show a calm
    // "Queued" label rather than a spinner over a fake progress bar.
    expect(isCliRunActive(result.current.phase)).toBe(true);
    expect(isCliRunSettled(result.current.phase)).toBe(false);
  });

  it('the legacy `pending` alias resolves to queued', async () => {
    const result = await runWithStatus('pending');
    expect(result.current.phase).toBe('queued');
  });

  it('an unparseable status becomes `unknown`, never `running`', async () => {
    const result = await runWithStatus('exploded-in-a-new-way');
    expect(result.current.phase).toBe('unknown');
    expect(isCliRunSettled(result.current.phase)).toBe(true);
  });

  it('an empty status is corruption, not a queue position', async () => {
    const result = await runWithStatus('   ');
    expect(result.current.phase).toBe('unknown');
  });

  it('a non-string status is rejected by the payload schema and changes nothing', async () => {
    // The schema validator drops the event before the phase is touched -- the
    // point is only that it does not end up as a phase.
    const result = await runWithStatus(42);
    expect(result.current.phase).not.toBe(42 as unknown as CliRunPhase);
    expect(isCliRunUnsuccessful(result.current.phase) || result.current.phase === 'running').toBe(true);
  });

  it('still handles the three statuses it always did', async () => {
    for (const status of ['running', 'completed', 'failed'] as const) {
      const result = await runWithStatus(status);
      expect(result.current.phase).toBe(status);
    }
  });
});

// ===========================================================================
// 2. onFailed stays scoped to a real failure
// ===========================================================================

describe('E2E: useCorrelatedCliStream -- onFailed scope', () => {
  it('fires onFailed for a failure', async () => {
    const onFailed = vi.fn();
    await runWithStatus('failed', onFailed);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onFailed for a cancel -- a cancel is not an error', async () => {
    const onFailed = vi.fn();
    const result = await runWithStatus('cancelled', onFailed);
    expect(onFailed).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('cancelled');
  });

  it('does NOT fire onFailed for incomplete or unknown', async () => {
    for (const status of ['incomplete', 'not-a-status'] as const) {
      const onFailed = vi.fn();
      await runWithStatus(status, onFailed);
      expect(onFailed).not.toHaveBeenCalled();
    }
  });
});

// ===========================================================================
// 3. The union covers the canonical vocabulary, and the helpers agree with it
// ===========================================================================

describe('CliRunPhase vocabulary', () => {
  it('covers every canonical execution state', () => {
    // If a new ExecutionState is added in Rust, `toCliRunPhase` must already
    // be able to return it -- this is the assertion that fails if it cannot.
    for (const state of EXECUTION_STATES) {
      expect(toCliRunPhase(state)).toBe(state);
    }
  });

  it('classifies every phase as exactly one of idle / active / settled', () => {
    const phases: CliRunPhase[] = ['idle', ...EXECUTION_STATES];
    for (const phase of phases) {
      const buckets = [
        phase === 'idle',
        isCliRunActive(phase),
        isCliRunSettled(phase),
      ].filter(Boolean);
      expect({ phase, buckets: buckets.length }).toEqual({ phase, buckets: 1 });
    }
  });

  it('counts every terminal state except completed as unsuccessful', () => {
    expect(isCliRunUnsuccessful('completed')).toBe(false);
    expect(isCliRunUnsuccessful('idle')).toBe(false);
    expect(isCliRunUnsuccessful('queued')).toBe(false);
    expect(isCliRunUnsuccessful('running')).toBe(false);
    for (const phase of ['failed', 'cancelled', 'incomplete', 'unknown'] as const) {
      expect(isCliRunUnsuccessful(phase)).toBe(true);
    }
  });

  it('treats null/undefined as unknown', () => {
    expect(toCliRunPhase(null)).toBe('unknown');
    expect(toCliRunPhase(undefined)).toBe('unknown');
  });
});
