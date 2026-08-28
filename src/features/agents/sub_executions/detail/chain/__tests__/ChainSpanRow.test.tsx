import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { ChainSpanRow } from '../ChainSpanRow';

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

function trace(spans: TraceSpan[]): ExecutionTrace {
  return {
    trace_id: 't1',
    execution_id: 'abcdef1234',
    persona_id: 'p1',
    chain_trace_id: 'c1',
    spans,
    total_duration_ms: 100,
    evicted_span_count: 0,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function renderRow(spans: TraceSpan[]) {
  render(<ChainSpanRow trace={trace(spans)} index={0} isCurrent={false} onOpen={vi.fn()} />);
  return screen.getByTestId('chain-span-cost').textContent;
}

describe('ChainSpanRow narrow-viewport layout', () => {
  it('wraps rather than clipping its six fixed-width slots', () => {
    render(<ChainSpanRow trace={trace([span()])} index={0} isCurrent={false} onOpen={vi.fn()} />);
    const row = screen.getByTestId('chain-span-row');
    // The parent hides its overflow, so a non-wrapping row is a row that
    // silently loses its metrics below ~420px.
    expect(row.className).toContain('flex-wrap');
  });
});

describe('ChainSpanRow cost fold', () => {
  it('reports the unknown marker when no span in the step carried a price', () => {
    // The regression this pins: `sum + (s.cost_usd ?? 0)` printed a confident
    // $0.0000 for a step nothing in it was priced for — and today the tracer
    // prices the root span alone, so that was the common case.
    expect(renderRow([span({ span_id: 'a' }), span({ span_id: 'b' })])).toBe('-');
  });

  it('reports a measured zero as a price, not as unpriced', () => {
    // `formatCost` renders a sub-cent amount as "<$0.001"; what matters here
    // is that a measured zero reaches the formatter at all rather than being
    // collapsed into the same dash a never-priced step gets.
    const text = renderRow([span({ cost_usd: 0 })]);
    expect(text).not.toBe('-');
    expect(text).toContain('$');
  });

  it('sums only the spans that carried a price', () => {
    const text = renderRow([
      span({ span_id: 'a', cost_usd: 0.02 }),
      span({ span_id: 'b', cost_usd: null }),
      span({ span_id: 'c', cost_usd: 0.03 }),
    ]);
    expect(text).toContain('0.05');
  });
});

describe('ChainSpanRow status icon', () => {
  function renderStatus(spans: TraceSpan[]) {
    render(<ChainSpanRow trace={trace(spans)} index={0} isCurrent={false} onOpen={vi.fn()} />);
    return screen.getByTestId('chain-span-status').getAttribute('class') ?? '';
  }

  it('claims success only for a run whose root span was closed', () => {
    expect(renderStatus([span({ end_ms: 100 })])).toContain('text-status-success');
  });

  it('does not claim success while the root span is still open', () => {
    // The regression this pins: the row's only evidence was "does any span
    // carry an error", so a run still in flight — whose root end_ms is stamped
    // by finalize() and nothing else — got a definitive green tick.
    const cls = renderStatus([span({ end_ms: null })]);
    expect(cls).not.toContain('text-status-success');
    expect(cls).not.toContain('text-status-error');
  });

  it('does not claim success for a trace with no spans at all', () => {
    expect(renderStatus([])).not.toContain('text-status-success');
  });

  it('still reports a failure over an unfinished root', () => {
    expect(renderStatus([span({ end_ms: null, error: 'boom' })])).toContain('text-status-error');
  });
});
