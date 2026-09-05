import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const executePersona = vi.hoisted(() => vi.fn());
vi.mock('@/api/agents/executions', () => ({ executePersona }));

import { useDeploymentTest } from '../useDeploymentTest';

beforeEach(() => { executePersona.mockReset(); });

describe('useDeploymentTest', () => {
  it('reports a completed run as pass with its recorded duration and cost', async () => {
    executePersona.mockResolvedValue({ status: 'completed', duration_ms: 420, cost_usd: 0.01, error_message: null });
    const { result } = renderHook(() => useDeploymentTest());
    await act(async () => { await result.current.runTest('dep-1', 'p1'); });
    expect(result.current.tests['dep-1']).toEqual({
      running: false,
      result: { status: 'pass', durationMs: 420, costUsd: 0.01, error: undefined },
    });
  });

  it('reports a thrown call as fail with cost NOT recorded (null), never as free (0)', async () => {
    executePersona.mockRejectedValue(new Error('endpoint unreachable'));
    const { result } = renderHook(() => useDeploymentTest());
    await act(async () => { await result.current.runTest('dep-1', 'p1'); });
    const r = result.current.tests['dep-1']!.result!;
    expect(r.status).toBe('fail');
    expect(r.error).toBe('endpoint unreachable');
    // The TestResult contract: null = never recorded; 0 would read as a free run.
    expect(r.costUsd).toBeNull();
    expect(r.durationMs).toBeNull();
  });

  it('dismisses a result on demand', async () => {
    executePersona.mockResolvedValue({ status: 'completed', duration_ms: 1, cost_usd: 0, error_message: null });
    const { result } = renderHook(() => useDeploymentTest());
    await act(async () => { await result.current.runTest('dep-1', 'p1'); });
    act(() => { result.current.dismissResult('dep-1'); });
    expect(result.current.tests['dep-1']).toBeUndefined();
  });
});
