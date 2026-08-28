import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { TraceSummary } from '../TraceSummary';

function span(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    span_id: 'root',
    parent_span_id: null,
    span_type: 'execution',
    name: 'Execution',
    start_ms: 0,
    end_ms: 100,
    duration_ms: 100,
    cost_usd: null,
    input_tokens: null,
    output_tokens: null,
    error: null,
    metadata: null,
    ...overrides,
  } as TraceSpan;
}

function trace(overrides: Partial<ExecutionTrace> = {}): ExecutionTrace {
  return {
    trace_id: 't1',
    execution_id: 'e1',
    persona_id: 'p1',
    chain_trace_id: null,
    spans: [span()],
    total_duration_ms: 100,
    evicted_span_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('TraceSummary eviction warning', () => {
  it('stays silent when no spans were evicted', () => {
    render(<TraceSummary trace={trace({ evicted_span_count: 0 })} errorCount={0} />);
    expect(screen.queryByText(/Trace incomplete/)).toBeNull();
  });

  it('uses the singular translation for exactly one evicted span', () => {
    render(<TraceSummary trace={trace({ evicted_span_count: 1 })} errorCount={0} />);
    // Singular "span", not the hand-spliced "span(s)" the DebtText markers produced.
    expect(screen.getByText(/1 span evicted/)).toBeTruthy();
    expect(screen.queryByText(/spans evicted/)).toBeNull();
  });

  it('uses the plural translation for more than one evicted span', () => {
    render(<TraceSummary trace={trace({ evicted_span_count: 42 })} errorCount={0} />);
    expect(screen.getByText(/42 spans evicted/)).toBeTruthy();
  });

  it('interpolates the span limit rather than baking it into the sentence', () => {
    render(<TraceSummary trace={trace({ evicted_span_count: 5 })} errorCount={0} />);
    // The 10,000 figure comes from MAX_TRACE_SPANS (mirrors src-tauri/core/src/trace.rs),
    // interpolated as {limit} — so it is grouped by the active locale, not literal text.
    expect(screen.getByText(/limit: 10,000/)).toBeTruthy();
  });
});

describe('TraceSummary error tile', () => {
  it('reports the caller-supplied count, not a fold of its own trace', () => {
    // The regression this pins: the tile folded `trace.spans` while the error
    // CARDS beneath it came from the unified trace (frontend pipeline spans
    // merged in). A run that failed in a pipeline stage therefore showed "0"
    // above the card explaining the failure.
    render(
      <TraceSummary trace={trace({ spans: [span()] })} errorCount={1} />,
    );
    expect(screen.getByTestId('trace-error-count').textContent).toBe('1');
  });

  it('does not invent errors from spans the caller did not count', () => {
    render(
      <TraceSummary trace={trace({ spans: [span({ error: 'boom' })] })} errorCount={0} />,
    );
    expect(screen.getByTestId('trace-error-count').textContent).toBe('0');
  });
});

describe('TraceSummary cost tile', () => {
  it('shows the unknown marker when the run was never priced', () => {
    render(<TraceSummary trace={trace({ spans: [span({ cost_usd: null })] })} errorCount={0} />);
    expect(screen.getByTestId('trace-cost').textContent).toBe('-');
  });

  it('shows a measured zero as zero, not as unpriced', () => {
    // `null` is "we could not price this run"; `0` is "this run was free".
    // The old `totalCost > 0` test printed the same dash for both.
    render(<TraceSummary trace={trace({ spans: [span({ cost_usd: 0 })] })} errorCount={0} />);
    expect(screen.getByTestId('trace-cost').textContent).toBe('$0.0000');
  });

  it('shows a measured price', () => {
    render(<TraceSummary trace={trace({ spans: [span({ cost_usd: 0.1234 })] })} errorCount={0} />);
    expect(screen.getByTestId('trace-cost').textContent).toBe('$0.1234');
  });
});

describe('TraceSummary tokens tile', () => {
  it('shows the unknown marker when the run was never measured', () => {
    // The regression this pins: tokens folded with `?? 0` while the cost on the
    // SAME object stayed nullable, so an aborted run — every abort path calls
    // finalize(None, None, None, err) — read "Cost -" beside "Tokens 0". One
    // honest dash and one fabricated measurement for the same missing number.
    render(
      <TraceSummary
        trace={trace({ spans: [span({ input_tokens: null, output_tokens: null })] })}
        errorCount={0}
      />,
    );
    expect(screen.getByTestId('trace-tokens').textContent).toBe('-');
  });

  it('shows a measured zero as zero, not as unmeasured', () => {
    render(
      <TraceSummary
        trace={trace({ spans: [span({ input_tokens: 0, output_tokens: 0 })] })}
        errorCount={0}
      />,
    );
    expect(screen.getByTestId('trace-tokens').textContent).toBe('0');
  });

  it('sums input and output when both were measured', () => {
    render(
      <TraceSummary
        trace={trace({ spans: [span({ input_tokens: 120, output_tokens: 80 })] })}
        errorCount={0}
      />,
    );
    expect(screen.getByTestId('trace-tokens').textContent).toContain('200');
  });
});
