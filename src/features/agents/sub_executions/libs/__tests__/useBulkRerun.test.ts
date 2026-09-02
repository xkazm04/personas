import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Two regression pins live here.
 *
 * 1. The stale-async defect: a single reused `cancelledRef` stopped the worker
 *    loop from picking up NEW items but did NOT abort in-flight
 *    `executePersona` promises from a PRIOR batch. Because `updateItem` is
 *    keyed by `originalId` (which can repeat across batches re-running the same
 *    executions), a stale completion from an old batch could land in the new
 *    cohort's state, corrupting its counts. Fixed via a `createLatestWins()`
 *    token minted in `start()` and threaded through `runOne`/`updateItem`.
 *
 * 2. The zero-cost report: `runOne` read cost/duration/tokens/status straight
 *    off `executePersona`'s return, which is the row as it looked immediately
 *    after the enqueue — 'queued', cost 0, duration null, tokens 0. Every
 *    report therefore read "$0.0431 -> $0.0000 · success". The hook now waits
 *    for each re-run to land before recording its outcome.
 */
vi.mock('@/api/agents/executions', () => ({
  executePersona: vi.fn(),
  getExecution: vi.fn(),
}));

import * as executionsApi from '@/api/agents/executions';
import { useBulkRerun } from '../useBulkRerun';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

const executePersonaMock = vi.mocked(executionsApi.executePersona);
const getExecutionMock = vi.mocked(executionsApi.getExecution);

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function row(id: string, status = 'failed'): ExecutionListItem {
  return {
    id,
    status,
    cost_usd: 1,
    duration_ms: 100,
    input_tokens: 10,
    output_tokens: 20,
    use_case_id: null,
  } as unknown as ExecutionListItem;
}

/** The row `execute_persona` returns right after the enqueue: nothing measured. */
function queuedResult(id: string): PersonaExecution {
  return {
    id,
    status: 'queued',
    cost_usd: 0,
    duration_ms: null,
    input_tokens: 0,
    output_tokens: 0,
    error_message: null,
  } as unknown as PersonaExecution;
}

function landedResult(id: string, status = 'completed', cost = 2): PersonaExecution {
  return {
    id,
    status,
    cost_usd: cost,
    duration_ms: 200,
    input_tokens: 15,
    output_tokens: 25,
    error_message: status === 'completed' ? null : 'boom',
  } as unknown as PersonaExecution;
}

/**
 * `getExecution` serves two callers: the input_data hydration for the ORIGINAL
 * row, and the landing poll for the NEW execution. Route by id.
 */
function routeGetExecution(landing: (id: string) => PersonaExecution) {
  getExecutionMock.mockImplementation(async (id: string) =>
    id.startsWith('new-exec')
      ? landing(id)
      : ({ input_data: null } as unknown as PersonaExecution),
  );
}

describe('useBulkRerun — stale-batch guard', () => {
  beforeEach(() => {
    executePersonaMock.mockReset();
    getExecutionMock.mockReset();
    routeGetExecution((id) => landedResult(id, 'completed'));
  });

  it('discards a stale batch-1 completion that resolves after batch 2 has started', async () => {
    const { result } = renderHook(() =>
      useBulkRerun({ pollIntervalMs: 0, pollTimeoutMs: 1_000 }),
    );

    const batch1 = deferred<PersonaExecution>();
    const batch2 = deferred<PersonaExecution>();
    // Batch 1 has a single row that re-uses id "shared-id" (same original id
    // batch 2 will also rerun) — the exact collision the bug corrupts.
    executePersonaMock.mockReturnValueOnce(batch1.promise);
    executePersonaMock.mockReturnValueOnce(batch2.promise);

    let startPromise1!: Promise<void>;
    act(() => {
      startPromise1 = result.current.start([row('shared-id')], 'persona-1');
    });

    // Batch 2 starts before batch 1's executePersona resolves.
    let startPromise2!: Promise<void>;
    act(() => {
      startPromise2 = result.current.start([row('shared-id')], 'persona-2');
    });

    // Batch 2 resolves first (fast).
    await act(async () => {
      batch2.resolve(queuedResult('new-exec-2'));
      await startPromise2;
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].newExecutionId).toBe('new-exec-2');
    expect(result.current.phase).toBe('completed');

    // The stale batch-1 completion finally resolves — it must NOT overwrite
    // batch 2's item with batch 1's (older) execution result.
    await act(async () => {
      batch1.resolve(queuedResult('new-exec-1'));
      await startPromise1;
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].newExecutionId).toBe('new-exec-2');
    expect(result.current.items[0].status).toBe('success');
  });
});

describe('useBulkRerun — reports what the re-runs actually cost', () => {
  beforeEach(() => {
    executePersonaMock.mockReset();
    getExecutionMock.mockReset();
  });

  it('records the real cost/duration/tokens of a run that completes AFTER dispatch', async () => {
    executePersonaMock.mockResolvedValue(queuedResult('new-exec-1'));
    // Still queued on the first two reads, landed on the third.
    let reads = 0;
    getExecutionMock.mockImplementation(async (id: string) => {
      if (!id.startsWith('new-exec')) return { input_data: null } as unknown as PersonaExecution;
      reads += 1;
      return reads < 3 ? queuedResult(id) : landedResult(id, 'completed', 2.5);
    });

    const { result } = renderHook(() =>
      useBulkRerun({ pollIntervalMs: 0, pollTimeoutMs: 5_000 }),
    );
    await act(async () => {
      await result.current.start([row('orig-1')], 'persona-1');
    });

    const item = result.current.items[0];
    expect(item.status).toBe('success');
    expect(item.newStatus).toBe('completed');
    expect(item.newCost).toBe(2.5);
    expect(item.newDurationMs).toBe(200);
    expect(item.newInputTokens).toBe(15);
    // The cohort aggregates the LANDED cost, not the enqueue-time zero.
    expect(result.current.cohort.totalCostNew).toBe(2.5);
    expect(result.current.cohort.meanCostDelta).toBeCloseTo(1.5);
    expect(result.current.cohort.finished).toBe(1);
  });

  it('reads a re-run that lands failed as a regression, not a success', async () => {
    executePersonaMock.mockResolvedValue(queuedResult('new-exec-1'));
    routeGetExecution((id) => landedResult(id, 'failed', 0.5));

    const { result } = renderHook(() =>
      useBulkRerun({ pollIntervalMs: 0, pollTimeoutMs: 5_000 }),
    );
    await act(async () => {
      // Originally PASSING, so a failed re-run is a regression.
      await result.current.start([row('orig-1', 'completed')], 'persona-1');
    });

    const item = result.current.items[0];
    expect(item.status).toBe('failed');
    expect(item.newStatus).toBe('failed');
    expect(result.current.cohort.regressionCount).toBe(1);
    expect(result.current.cohort.successCount).toBe(0);
  });

  it('leaves a still-running re-run pending — never a $0.00 success', async () => {
    executePersonaMock.mockResolvedValue(queuedResult('new-exec-1'));
    routeGetExecution((id) => queuedResult(id)); // never lands

    const { result } = renderHook(() =>
      useBulkRerun({ pollIntervalMs: 0, pollTimeoutMs: 0 }),
    );
    await act(async () => {
      await result.current.start([row('orig-1')], 'persona-1');
    });

    const item = result.current.items[0];
    // The new execution IS known — the user can still drill into it.
    expect(item.newExecutionId).toBe('new-exec-1');
    // ...but nothing about its outcome is claimed.
    expect(item.status).toBe('running');
    expect(item.newStatus).toBeNull();
    expect(item.newCost).toBeNull();
    expect(item.newDurationMs).toBeNull();
    expect(result.current.cohort.successCount).toBe(0);
    expect(result.current.cohort.finished).toBe(0);
    expect(result.current.cohort.totalCostNew).toBe(0);
    expect(result.current.cohort.meanCostDelta).toBe(0);
  });
});
