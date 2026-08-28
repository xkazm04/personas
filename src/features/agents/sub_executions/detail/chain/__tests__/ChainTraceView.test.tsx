import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { ChainTraceView } from '../ChainTraceView';

function span(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    span_id: 's1',
    parent_span_id: null,
    span_type: 'execution',
    name: 'Execution',
    start_ms: 0,
    end_ms: 100,
    duration_ms: 100,
    cost_usd: null,
    error: null,
    metadata: null,
    ...overrides,
  } as TraceSpan;
}

function trace(id: string, cost: number | null): ExecutionTrace {
  return {
    trace_id: `t-${id}`,
    execution_id: `exec-${id}`,
    persona_id: 'p1',
    chain_trace_id: 'c1',
    spans: [span({ span_id: `s-${id}`, cost_usd: cost })],
    total_duration_ms: 100,
    evicted_span_count: 0,
    created_at: '2026-01-01T00:00:00Z',
  };
}

/**
 * The header total and the rows disagreed about what a null cost meant:
 * `ChainSpanRow` prints a dash for an unpriced step, while `sumChainCost`
 * folded every unpriced span to 0. A three-step chain with only the first step
 * priced therefore printed a confident, complete-looking total above two rows
 * that openly said they did not know — and today's tracer prices the root span
 * alone, so that was the common shape, not a corner case.
 */
function renderChain(traces: ExecutionTrace[], chainCostUsd: number, chainPricedTraces: number) {
  render(
    <ChainTraceView
      traces={traces}
      loading={false}
      error={null}
      partial={false}
      stopReasons={[]}
      chainCostUsd={chainCostUsd}
      chainPricedTraces={chainPricedTraces}
      currentExecutionId="exec-a"
      onOpenExecution={vi.fn()}
    />,
  );
}

describe('ChainTraceView total cost', () => {
  it('reports the unknown marker when no run in the chain was priced', () => {
    renderChain([trace('a', null), trace('b', null)], 0, 0);
    expect(screen.getByTestId('chain-total-cost').textContent).toBe('-');
    expect(screen.queryByTestId('chain-cost-partial')).toBeNull();
  });

  it('labels a partly-priced chain instead of presenting it as the total', () => {
    renderChain([trace('a', 0.02), trace('b', null), trace('c', null)], 0.02, 1);
    expect(screen.getByTestId('chain-total-cost').textContent).toContain('0.02');
    expect(screen.getByTestId('chain-cost-partial').textContent).toContain('1');
    expect(screen.getByTestId('chain-cost-partial').textContent).toContain('3');
  });

  it('says nothing extra when every run in the chain carried a price', () => {
    renderChain([trace('a', 0.02), trace('b', 0.03)], 0.05, 2);
    expect(screen.getByTestId('chain-total-cost').textContent).toContain('0.05');
    expect(screen.queryByTestId('chain-cost-partial')).toBeNull();
  });
});
