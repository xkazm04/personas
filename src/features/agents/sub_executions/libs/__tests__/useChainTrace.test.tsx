/**
 * A failed stop-reason read must be distinguishable from a chain that recorded
 * no stop. `useChainTrace` used to fold the rejection into `[]`, so the Chain
 * tab rendered an empty audit for both.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, render, screen } from '@testing-library/react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { ChainStopReason } from '@/lib/bindings/ChainStopReason';

const getExecutionTrace = vi.fn();
const getChainTrace = vi.fn();
const getChainStopReasons = vi.fn();
vi.mock('@/api/agents/executions', () => ({
  getExecutionTrace: (...a: unknown[]) => getExecutionTrace(...a),
  getChainTrace: (...a: unknown[]) => getChainTrace(...a),
  getChainStopReasons: (...a: unknown[]) => getChainStopReasons(...a),
}));
vi.mock('@/lib/silentCatch', () => ({
  extractMessage: (e: unknown) => String(e),
  silentCatch: () => () => undefined,
}));

import { useChainTrace } from '../useChainTrace';
import { ChainTraceView } from '../../detail/chain/ChainTraceView';

const trace = {
  trace_id: 't1', execution_id: 'e1', persona_id: 'p1', chain_trace_id: 'c1', spans: [],
  total_duration_ms: 1, evicted_span_count: 0, created_at: '2026-01-01T00:00:00Z',
} as unknown as ExecutionTrace;

beforeEach(() => {
  getExecutionTrace.mockResolvedValue(trace);
  getChainTrace.mockResolvedValue([trace]);
});

describe('useChainTrace stop reasons', () => {
  it('flags a failed stop-reason read instead of folding it into an empty list', async () => {
    getChainStopReasons.mockRejectedValue(new Error('db locked'));
    const { result } = renderHook(() => useChainTrace('e1', 'p1'));
    await waitFor(() => expect(result.current.hasChain).toBe(true));
    expect(result.current.stopReasons).toEqual([]);
    expect(result.current.stopReasonsError).toBe(true);
  });

  it('does not flag a read that succeeded empty', async () => {
    getChainStopReasons.mockResolvedValue([] as ChainStopReason[]);
    const { result } = renderHook(() => useChainTrace('e1', 'p1'));
    await waitFor(() => expect(result.current.hasChain).toBe(true));
    expect(result.current.stopReasonsError).toBe(false);
  });
});

describe('ChainTraceView stop-reason failure', () => {
  const view = (stopReasonsError: boolean) =>
    render(
      <ChainTraceView
        traces={[trace]} loading={false} error={null} partial={false} stopReasons={[]}
        stopReasonsError={stopReasonsError} chainCostUsd={0} chainPricedTraces={0}
        currentExecutionId="e1" onOpenExecution={vi.fn()}
      />,
    );

  it('renders the unavailable notice only when the read failed', () => {
    const { unmount } = view(false);
    expect(screen.queryByTestId('chain-stop-reasons-unavailable')).toBeNull();
    unmount();
    view(true);
    expect(screen.getByTestId('chain-stop-reasons-unavailable')).toBeTruthy();
  });
});
