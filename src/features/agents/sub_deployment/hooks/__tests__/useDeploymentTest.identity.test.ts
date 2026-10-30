import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/api/agents/executions', () => ({ executePersona: vi.fn() }));
vi.mock('../awaitExecutionResult', () => ({ awaitExecutionResult: vi.fn() }));

import { executePersona } from '@/api/agents/executions';
import { awaitExecutionResult } from '../awaitExecutionResult';
import { useDeploymentTest } from '../useDeploymentTest';

/**
 * Instrument: the number of DISTINCT `runTest` identities a hook instance hands
 * out across one full test run (start -> running -> result -> dismiss). Every
 * new identity re-renders every deployment row that receives `onTest`.
 */
describe('useDeploymentTest runTest identity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps one runTest identity across a start, a result and a dismiss', async () => {
    let release!: (v: unknown) => void;
    vi.mocked(executePersona).mockResolvedValue({ id: 'e1' } as never);
    vi.mocked(awaitExecutionResult).mockReturnValue(new Promise((r) => { release = r; }) as never);

    const { result } = renderHook(() => useDeploymentTest());
    const seen = new Set<unknown>([result.current.runTest]);

    let run!: Promise<void>;
    act(() => { run = result.current.runTest('d1', 'p1'); });
    seen.add(result.current.runTest);
    expect(result.current.tests.d1?.running).toBe(true);

    await act(async () => {
      release({ status: 'completed', duration_ms: 5, cost_usd: 0.1, error_message: null });
      await run;
    });
    seen.add(result.current.runTest);
    expect(result.current.tests.d1?.result?.status).toBe('pass');

    act(() => result.current.dismissResult('d1'));
    seen.add(result.current.runTest);

    expect(seen.size).toBe(1);
  });

  it('still refuses a second start while the first is running (guard holds across renders)', async () => {
    let release!: (v: unknown) => void;
    vi.mocked(executePersona).mockResolvedValue({ id: 'e1' } as never);
    vi.mocked(awaitExecutionResult).mockReturnValue(new Promise((r) => { release = r; }) as never);

    const { result } = renderHook(() => useDeploymentTest());
    let first!: Promise<void>;
    act(() => { first = result.current.runTest('d1', 'p1'); });
    // A stale reference taken before the running state landed must also be refused.
    const stale = result.current.runTest;
    await act(async () => { await stale('d1', 'p1'); });
    expect(executePersona).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ status: 'completed', duration_ms: 1, cost_usd: 0, error_message: null });
      await first;
    });
    // Once finished, the same deployment may be tested again.
    vi.mocked(awaitExecutionResult).mockResolvedValue({ status: 'completed', duration_ms: 1, cost_usd: 0, error_message: null } as never);
    await act(async () => { await result.current.runTest('d1', 'p1'); });
    expect(executePersona).toHaveBeenCalledTimes(2);
  });
});
