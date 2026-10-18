import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const executePersona = vi.hoisted(() => vi.fn());
const getExecution = vi.hoisted(() => vi.fn());
vi.mock('@/api/agents/executions', () => ({ executePersona, getExecution }));

import { useDeploymentTest } from '../useDeploymentTest';

// `execute_persona` returns the row as queued (SpawnEngine stage), not the
// finished run - the mocks below follow that contract.
const queued = { id: 'exec-1', status: 'queued', duration_ms: null, cost_usd: null, error_message: null };

beforeEach(() => {
  executePersona.mockReset();
  getExecution.mockReset();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

async function run(result: { current: ReturnType<typeof useDeploymentTest> }) {
  await act(async () => {
    const p = result.current.runTest('dep-1', 'p1');
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
  });
}

describe('useDeploymentTest', () => {
  it('waits for a queued run to land and reports it as pass with its recorded duration and cost', async () => {
    executePersona.mockResolvedValue(queued);
    getExecution
      .mockResolvedValueOnce({ ...queued, status: 'running' })
      .mockResolvedValueOnce({ ...queued, status: 'completed', duration_ms: 420, cost_usd: 0.01 });
    const { result } = renderHook(() => useDeploymentTest());
    await run(result);
    expect(getExecution).toHaveBeenCalledWith('exec-1', 'p1');
    expect(result.current.tests['dep-1']).toEqual({
      running: false,
      result: { status: 'pass', durationMs: 420, costUsd: 0.01, error: undefined },
    });
  });

  it('reports a run that lands failed as fail with its error', async () => {
    executePersona.mockResolvedValue(queued);
    getExecution.mockResolvedValue({ ...queued, status: 'failed', duration_ms: 9, cost_usd: 0, error_message: 'boom' });
    const { result } = renderHook(() => useDeploymentTest());
    await run(result);
    const r = result.current.tests['dep-1']!.result!;
    expect(r.status).toBe('fail');
    expect(r.error).toBe('boom');
  });

  it('reports a thrown call as fail with cost NOT recorded (null), never as free (0)', async () => {
    executePersona.mockRejectedValue(new Error('endpoint unreachable'));
    const { result } = renderHook(() => useDeploymentTest());
    await run(result);
    const r = result.current.tests['dep-1']!.result!;
    expect(r.status).toBe('fail');
    expect(r.error).toBe('endpoint unreachable');
    // The TestResult contract: null = never recorded; 0 would read as a free run.
    expect(r.costUsd).toBeNull();
    expect(r.durationMs).toBeNull();
  });

  it('dismisses a result on demand', async () => {
    executePersona.mockResolvedValue({ ...queued, status: 'completed', duration_ms: 1, cost_usd: 0 });
    const { result } = renderHook(() => useDeploymentTest());
    await run(result);
    act(() => { result.current.dismissResult('dep-1'); });
    expect(result.current.tests['dep-1']).toBeUndefined();
  });
});
