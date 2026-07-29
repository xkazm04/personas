import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Regression pin for the stale-async defect in `useBulkRerun`: a single
 * reused `cancelledRef` stopped the worker loop from picking up NEW items
 * but did NOT abort in-flight `executePersona` promises from a PRIOR batch.
 * Because `updateItem` is keyed by `originalId` (which can repeat across
 * batches re-running the same executions), a stale completion from an old
 * batch could land in the new cohort's state, corrupting its counts. Fixed
 * via a `createLatestWins()` token minted in `start()` and threaded through
 * `runOne`/`updateItem`.
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

function row(id: string): ExecutionListItem {
  return {
    id,
    status: 'failed',
    cost_usd: 1,
    duration_ms: 100,
    input_tokens: 10,
    output_tokens: 20,
    use_case_id: null,
  } as unknown as ExecutionListItem;
}

function execResult(id: string, status = 'completed'): PersonaExecution {
  return {
    id,
    status,
    cost_usd: 2,
    duration_ms: 200,
    input_tokens: 15,
    output_tokens: 25,
    error_message: null,
  } as unknown as PersonaExecution;
}

describe('useBulkRerun — stale-batch guard', () => {
  beforeEach(() => {
    executePersonaMock.mockReset();
    getExecutionMock.mockReset();
    getExecutionMock.mockResolvedValue({ input_data: null } as unknown as PersonaExecution);
  });

  it('discards a stale batch-1 completion that resolves after batch 2 has started', async () => {
    const { result } = renderHook(() => useBulkRerun());

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
      batch2.resolve(execResult('new-exec-2', 'completed'));
      await startPromise2;
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].newExecutionId).toBe('new-exec-2');
    expect(result.current.phase).toBe('completed');

    // The stale batch-1 completion finally resolves — it must NOT overwrite
    // batch 2's item with batch 1's (older) execution result.
    await act(async () => {
      batch1.resolve(execResult('new-exec-1', 'failed'));
      await startPromise1;
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].newExecutionId).toBe('new-exec-2');
    expect(result.current.items[0].status).toBe('success');
  });
});
