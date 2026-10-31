/**
 * Three ways a bulk re-run cohort said one thing and did another.
 *
 * 1. A cancelled cohort was not stopped, only paused. `cancel()` set a shared
 *    `cancelledRef`; `start()` of the next cohort cleared it again, so the
 *    first cohort's workers - still awaiting their in-flight dispatches -
 *    resumed draining THEIR queue. Every one of those dispatches ran under a
 *    stale latest-wins token, so `updateItem` dropped its result: the re-runs
 *    the operator cancelled were dispatched, billed, and never shown.
 * 2. A failed read of the ORIGINAL run's input was logged and the run was
 *    re-dispatched with no input at all - a different run, billed, and then
 *    compared against the original as if it were a re-run of it.
 * 3. The cohort's mean cost delta was 0 when no landed run had both costs, so
 *    the report printed "$0.0000 - no change" for a delta nobody measured.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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

function row(id: string, cost: number | null = 1): ExecutionListItem {
  return {
    id, status: 'failed', cost_usd: cost, duration_ms: 100,
    input_tokens: 10, output_tokens: 20, use_case_id: null,
  } as unknown as ExecutionListItem;
}

function exec(id: string, status: string, cost: number | null): PersonaExecution {
  return {
    id, status, cost_usd: cost, duration_ms: 200, input_tokens: 1, output_tokens: 1,
    error_message: null, input_data: '{"q":1}',
  } as unknown as PersonaExecution;
}

beforeEach(() => {
  executePersonaMock.mockReset();
  getExecutionMock.mockReset();
});

describe('useBulkRerun dispatch discipline', () => {
  it('dispatches nothing more for a cancelled cohort once a new cohort starts', async () => {
    const held: Array<(v: PersonaExecution) => void> = [];
    let n = 0;
    executePersonaMock.mockImplementation(() => {
      n += 1;
      if (n <= 3) return new Promise<PersonaExecution>((r) => { held.push(r); });
      return Promise.resolve(exec(`new-exec-${n}`, 'queued', 0));
    });
    getExecutionMock.mockImplementation(async (id: string) =>
      id.startsWith('new-exec') ? exec(id, 'completed', 2) : exec(id, 'failed', 1));

    const { result } = renderHook(() => useBulkRerun({ pollIntervalMs: 0, pollTimeoutMs: 1_000 }));

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.start(['a', 'b', 'c', 'd', 'e'].map((id) => row(id)), 'p1');
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(executePersonaMock).toHaveBeenCalledTimes(3); // three workers, three in flight

    act(() => { result.current.cancel(); });
    await act(async () => { await result.current.start([row('z')], 'p1'); });
    expect(executePersonaMock).toHaveBeenCalledTimes(4); // the new cohort's one run

    await act(async () => {
      held.forEach((resolve, i) => resolve(exec(`new-exec-held-${i}`, 'queued', 0)));
      await first;
    });
    // 'd' and 'e' were cancelled. They must never be dispatched.
    expect(executePersonaMock).toHaveBeenCalledTimes(4);
  });

  it('does not re-run with an empty input when the original input cannot be read', async () => {
    getExecutionMock.mockRejectedValue(new Error('ipc down'));
    executePersonaMock.mockResolvedValue(exec('new-exec-1', 'queued', 0));

    const { result } = renderHook(() => useBulkRerun({ pollIntervalMs: 0, pollTimeoutMs: 0 }));
    await act(async () => { await result.current.start([row('orig-1')], 'p1'); });

    expect(executePersonaMock).not.toHaveBeenCalled();
    expect(result.current.items[0]!.status).toBe('failed');
    expect(result.current.items[0]!.newExecutionId).toBeNull();
    expect(result.current.items[0]!.error).toBeTruthy();
  });

  it('reports no mean cost delta when no landed run carries both costs', async () => {
    getExecutionMock.mockImplementation(async (id: string) =>
      id.startsWith('new-exec') ? exec(id, 'completed', null) : exec(id, 'failed', 1));
    executePersonaMock.mockResolvedValue(exec('new-exec-1', 'queued', 0));

    const { result } = renderHook(() => useBulkRerun({ pollIntervalMs: 0, pollTimeoutMs: 1_000 }));
    await act(async () => { await result.current.start([row('orig-1', null)], 'p1'); });

    expect(result.current.items[0]!.status).toBe('success');
    expect(result.current.cohort.meanCostDelta).toBeNull();
  });
});
