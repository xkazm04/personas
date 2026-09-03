/**
 * RELOADING DURING A LONG RUN MUST NOT COST YOU THE TRANSCRIPT.
 *
 * `usePersonaExecution` is the hook the whole foreground run hangs off — the
 * terminal output, the reload recovery, the queue badge, the teardown of
 * `isExecuting` — and at 358 LOC it had ZERO tests. The defects pinned here:
 *
 *  1. The recovery replay called `getExecutionLogLines(execId, personaId)` with
 *     no offset and no limit. That is not "give me everything": the backend
 *     command selects TAIL mode when `offset` is absent and returns the last
 *     500 matching lines. A run that had produced 1,200 lines before the reload
 *     came back with 500 and lost 700 silently. It now pages FORWARD.
 *  2. The dedup that protects the replay from double-printing lines the live
 *     event bus already delivered is counted, not set-based — repeated
 *     identical lines (`...`, a spinner frame, a blank banner) must survive.
 *  3. A late or duplicated terminal event for a PRIOR run must not tear down
 *     the live run's UI.
 *  4. A run navigated away from must still finalize: when the focused stream is
 *     detached by a persona switch, the background status listener owns the
 *     terminal event, and the final output chunk must be in the store BEFORE
 *     the terminal state is committed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';

const { getExecutionLogLinesMock } = vi.hoisted(() => ({
  getExecutionLogLinesMock: vi.fn(),
}));
vi.mock('@/api/agents/executions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getExecutionLogLines: getExecutionLogLinesMock,
  // The finalize path refreshes the list; keep it inert and silent.
  listExecutionsSummary: vi.fn().mockResolvedValue([]),
  getExecution: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/notifications/checkHumanReviews', () => ({
  checkNewHumanReviews: vi.fn().mockResolvedValue(undefined),
}));

import { useAgentStore } from '@/stores/agentStore';
import { executionSink } from '@/lib/execution/executionSink';
import { usePersonaExecution } from '../usePersonaExecution';

/**
 * Every handler `listen()` was ever given, kept even after its unlisten runs.
 *
 * Deliberate: an event already in flight when a listener is torn down is
 * exactly the race the late-duplicate guard exists for, and the only way to
 * reproduce it is to hold the closure the way the IPC bridge does.
 */
type Handler = (event: { payload: Record<string, unknown> }) => void;
let registered: { name: string; cb: Handler }[] = [];

function emitTo(name: string, payload: Record<string, unknown>) {
  for (const h of registered) {
    if (h.name === name) h.cb({ payload });
  }
}

function seedRun(execId: string, personaId: string) {
  useAgentStore.setState({
    activeExecutionId: execId,
    executionPersonaId: personaId,
    selectedPersonaId: personaId,
    isExecuting: true,
    executionOutput: [],
    executionOutputBytes: 0,
    pipelineTrace: null,
    backgroundExecutions: [],
    executions: [],
    personas: [],
    chatStreaming: false,
  });
}

beforeEach(() => {
  registered = [];
  getExecutionLogLinesMock.mockReset();
  executionSink.reset();
  vi.mocked(listen).mockImplementation(((name: string, cb: Handler) => {
    registered.push({ name, cb });
    return Promise.resolve(() => {});
  }) as unknown as typeof listen);
  useAgentStore.setState({
    activeExecutionId: null,
    executionPersonaId: null,
    selectedPersonaId: null,
    isExecuting: false,
    executionOutput: [],
    executionOutputBytes: 0,
    backgroundExecutions: [],
    pipelineTrace: null,
    chatStreaming: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Reload recovery: forward pagination
// ---------------------------------------------------------------------------

describe('reload recovery replay', () => {
  /** A backend that honours offset/limit exactly as the Rust command does. */
  function servePagedLog(lines: string[]) {
    getExecutionLogLinesMock.mockImplementation(
      async (_id: string, _persona: string, offset?: number, limit?: number) => {
        // Tail mode is what the OLD call site got: no offset => last 500.
        if (offset === undefined) return lines.slice(-(limit ?? 500));
        return lines.slice(offset, offset + (limit ?? 500));
      },
    );
  }

  it('restores all 1,200 lines of a long run, not just the last 500', async () => {
    const log = Array.from({ length: 1200 }, (_, i) => `line-${i}`);
    servePagedLog(log);
    seedRun('exec-long', 'p-1');

    renderHook(() => usePersonaExecution());

    await waitFor(() => {
      expect(useAgentStore.getState().executionOutput.length).toBe(1200);
    });

    const out = useAgentStore.getState().executionOutput;
    expect(out[0]).toBe('line-0');
    expect(out[1199]).toBe('line-1199');

    // The exact failure being fixed: the command must never be called in tail
    // mode, because tail mode silently answers a different question.
    for (const call of getExecutionLogLinesMock.mock.calls) {
      expect(call[2]).not.toBeUndefined();
    }
    // 1,200 lines at a 500 page size = 3 pages, the third of them short.
    expect(getExecutionLogLinesMock).toHaveBeenCalledTimes(3);
    expect(getExecutionLogLinesMock.mock.calls.map((c) => c[2])).toEqual([0, 500, 1000]);
  });

  it('stops on the first short page — one round trip for a short run', async () => {
    servePagedLog(Array.from({ length: 12 }, (_, i) => `l${i}`));
    seedRun('exec-short', 'p-1');

    renderHook(() => usePersonaExecution());

    await waitFor(() => {
      expect(useAgentStore.getState().executionOutput.length).toBe(12);
    });
    expect(getExecutionLogLinesMock).toHaveBeenCalledTimes(1);
  });

  it('stops on an empty first page without appending anything', async () => {
    servePagedLog([]);
    seedRun('exec-empty', 'p-1');

    renderHook(() => usePersonaExecution());

    await waitFor(() => {
      expect(getExecutionLogLinesMock).toHaveBeenCalledTimes(1);
    });
    expect(useAgentStore.getState().executionOutput).toEqual([]);
  });

  it('dedups against lines the live stream already delivered, by COUNT', async () => {
    // Three identical `...` lines in the persisted log, two of them already on
    // screen. A set-based dedup would drop the third; a counted one keeps it.
    servePagedLog(['a', '...', '...', '...', 'b']);
    seedRun('exec-dedup', 'p-1');
    // Seed through the real writer: `executionOutput` is owned by
    // `executionSink`, and a direct setState is overwritten by its next flush.
    act(() => {
      for (const l of ['a', '...', '...']) useAgentStore.getState().appendExecutionOutput(l);
    });
    await waitFor(() => {
      expect(useAgentStore.getState().executionOutput).toEqual(['a', '...', '...']);
    });

    renderHook(() => usePersonaExecution());

    await waitFor(() => {
      expect(useAgentStore.getState().executionOutput.length).toBe(5);
    });
    expect(useAgentStore.getState().executionOutput).toEqual(['a', '...', '...', '...', 'b']);
  });

  it('does not replay at all when no run is active', async () => {
    servePagedLog(['x']);
    renderHook(() => usePersonaExecution());
    await act(async () => { await Promise.resolve(); });
    expect(getExecutionLogLinesMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. The late-duplicate-terminal guard
// ---------------------------------------------------------------------------

describe('late/duplicate terminal events', () => {
  it('a terminal event for a PRIOR run does not tear down the live run', async () => {
    getExecutionLogLinesMock.mockResolvedValue([]);
    seedRun('exec-A', 'p-1');

    renderHook(() => usePersonaExecution());
    await waitFor(() => {
      expect(registered.some((h) => h.name === EventName.EXECUTION_STATUS)).toBe(true);
    });

    // Run A's correlated status handler, captured while A was focused.
    const aHandler = registered.find((h) => h.name === EventName.EXECUTION_STATUS)!.cb;

    // The focus moves on to run B while A's event is still in flight.
    act(() => {
      useAgentStore.setState({ activeExecutionId: 'exec-B', isExecuting: true });
    });

    act(() => {
      aHandler({ payload: { execution_id: 'exec-A', status: 'completed' } });
    });

    // B is untouched: still executing, still focused.
    expect(useAgentStore.getState().activeExecutionId).toBe('exec-B');
    expect(useAgentStore.getState().isExecuting).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. The detach/finalize contract
// ---------------------------------------------------------------------------

describe('detached focused stream', () => {
  it('a run navigated away from is still finalized by the background listener', async () => {
    getExecutionLogLinesMock.mockResolvedValue([]);
    seedRun('exec-A', 'p-1');

    const { rerender } = renderHook(() => usePersonaExecution());
    await waitFor(() => {
      expect(registered.some((h) => h.name === EventName.EXECUTION_STATUS)).toBe(true);
    });

    // Navigate to another persona mid-run. The correlated stream is torn down;
    // activeExecutionId stays set because the run keeps going in the backend.
    await act(async () => {
      useAgentStore.setState({ selectedPersonaId: 'p-2' });
      rerender();
      await Promise.resolve();
    });
    expect(useAgentStore.getState().activeExecutionId).toBe('exec-A');
    expect(useAgentStore.getState().isExecuting).toBe(true);

    // The terminal event now reaches only the background listener.
    await act(async () => {
      emitTo(EventName.EXECUTION_STATUS, { execution_id: 'exec-A', status: 'completed' });
      await Promise.resolve();
    });

    expect(useAgentStore.getState().activeExecutionId).toBeNull();
    expect(useAgentStore.getState().isExecuting).toBe(false);
  });

  it('does NOT finalize the focused run while its own stream is still live', async () => {
    getExecutionLogLinesMock.mockResolvedValue([]);
    seedRun('exec-A', 'p-1');

    renderHook(() => usePersonaExecution());
    await waitFor(() => {
      expect(registered.filter((h) => h.name === EventName.EXECUTION_STATUS).length)
        .toBeGreaterThanOrEqual(2);
    });

    // Both listeners see it; the background one must defer to the live stream
    // rather than double-finalizing. The correlated one finalizes exactly once.
    await act(async () => {
      emitTo(EventName.EXECUTION_STATUS, { execution_id: 'exec-A', status: 'completed' });
      await Promise.resolve();
    });

    expect(useAgentStore.getState().isExecuting).toBe(false);
    expect(useAgentStore.getState().lastExecutionId).toBe('exec-A');
  });
});

// ---------------------------------------------------------------------------
// 4. The final chunk lands before the terminal state is committed
// ---------------------------------------------------------------------------

describe('final output chunk', () => {
  it('the last line and the error line are in the completed snapshot', async () => {
    getExecutionLogLinesMock.mockResolvedValue([]);
    seedRun('exec-A', 'p-1');

    renderHook(() => usePersonaExecution());
    await waitFor(() => {
      expect(registered.some((h) => h.name === EventName.EXECUTION_STATUS)).toBe(true);
    });

    // A line written through the sink's throttled path — without the
    // forceFlush() that opens finishExecution, this never reaches the store
    // before the snapshot is taken.
    act(() => {
      useAgentStore.getState().appendExecutionOutput('final line');
    });

    await act(async () => {
      emitTo(EventName.EXECUTION_STATUS, {
        execution_id: 'exec-A',
        status: 'failed',
        error: 'boom',
      });
      await Promise.resolve();
    });

    const snapshot = useAgentStore.getState().consumeCompletedOutput('exec-A');
    expect(snapshot).toBeDefined();
    expect(snapshot).toContain('final line');
    expect(snapshot).toContain('[ERROR] boom');
  });
});
