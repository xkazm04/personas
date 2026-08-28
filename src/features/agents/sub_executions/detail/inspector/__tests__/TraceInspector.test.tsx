import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PersonaExecution } from '@/lib/types/types';
import type { UnifiedSpan } from '@/lib/execution/pipeline';

vi.mock('../useTraceData', () => ({ useTraceData: vi.fn() }));

import { useTraceData } from '../useTraceData';
import { TraceInspector } from '../TraceInspector';

const mockedUseTraceData = vi.mocked(useTraceData);

function erroredSpan(i: number): UnifiedSpan {
  return {
    span_id: `s${i}`,
    parent_span_id: null,
    span_type: 'tool_call',
    name: `step-${i}`,
    start_ms: 0,
    end_ms: 1,
    duration_ms: 1,
    cost_usd: null,
    error: `boom-${i}`,
    metadata: null,
  } as UnifiedSpan;
}

function arrange(errorCount: number, droppedSpanEvents = 0) {
  const spans = Array.from({ length: errorCount }, (_, i) => erroredSpan(i));
  mockedUseTraceData.mockReturnValue({
    droppedSpanEvents,
    spanEventBufferCap: 10_000,
    trace: null,
    unifiedTrace: { executionId: 'e1', spans, startedAt: 0, completedAt: 1 },
    loading: false,
    error: null,
    retry: vi.fn(),
    collapsedSpans: new Set<string>(),
    toggleSpan: vi.fn(),
    visibleNodes: [],
    totalMs: 1,
    childrenMap: new Map<string, boolean>(),
  } as unknown as ReturnType<typeof useTraceData>);

  render(<TraceInspector execution={{ id: 'e1', persona_id: 'p1' } as PersonaExecution} />);
}

describe('TraceInspector error cards', () => {
  beforeEach(() => mockedUseTraceData.mockReset());

  it('renders every card and no cut notice when the trace is under the budget', () => {
    arrange(3);
    expect(screen.getAllByText(/^boom-\d+$/)).toHaveLength(3);
    expect(screen.queryByTestId('trace-error-cards-capped')).toBeNull();
  });

  it('caps a pathological trace at the budget and states the cut', () => {
    // A retry loop can put thousands of errored spans in one trace; uncapped,
    // the section grew without limit exactly when the run went worst.
    arrange(500);
    expect(screen.getAllByText(/^boom-\d+$/)).toHaveLength(50);
    expect(screen.getByTestId('trace-error-cards-capped')).toHaveTextContent('50');
    expect(screen.getByTestId('trace-error-cards-capped')).toHaveTextContent('500');
  });
});

describe('TraceInspector live-buffer truncation signal', () => {
  beforeEach(() => mockedUseTraceData.mockReset());

  it('stays silent when the fetch-window buffer never overflowed', () => {
    arrange(1, 0);
    expect(screen.queryByTestId('trace-live-events-dropped')).toBeNull();
  });

  it('states the drop count and the cap that produced it', () => {
    // The backend ceiling is signalled through evicted_span_count; this is the
    // frontend half, which clipped the same derived numbers with no signal.
    arrange(1, 7);
    const banner = screen.getByTestId('trace-live-events-dropped');
    expect(banner).toHaveTextContent('7');
    expect(banner).toHaveTextContent('10,000');
  });
});

/**
 * The Spans tile used to print `trace.spans.length` — the BACKEND-only set —
 * while the Errors tile beside it and the waterfall directly beneath it both
 * counted the UNIFIED set (backend spans plus the frontend pipeline stages
 * merged in by `mergeBackendSpans`). The tile under-reported by exactly the
 * pipeline stages, so Errors could exceed Spans on the same strip.
 */
describe('TraceInspector summary strip counts one population', () => {
  beforeEach(() => mockedUseTraceData.mockReset());

  it('counts the unified span set, not the backend-only set', () => {
    const backendSpans = [erroredSpan(0), erroredSpan(1)];
    const unifiedSpans = [erroredSpan(0), erroredSpan(1), erroredSpan(2), erroredSpan(3)];
    mockedUseTraceData.mockReturnValue({
      droppedSpanEvents: 0,
      spanEventBufferCap: 10_000,
      trace: {
        trace_id: 't1',
        execution_id: 'e1',
        persona_id: 'p1',
        chain_trace_id: null,
        spans: backendSpans,
        total_duration_ms: 100,
        evicted_span_count: 0,
        created_at: '2026-01-01T00:00:00Z',
      },
      traceIsSynthetic: false,
      unifiedTrace: { executionId: 'e1', spans: unifiedSpans, startedAt: 0, completedAt: 100 },
      loading: false,
      error: null,
      retry: vi.fn(),
      collapsedSpans: new Set<string>(),
      toggleSpan: vi.fn(),
      visibleNodes: [],
      totalMs: 100,
      childrenMap: new Map<string, boolean>(),
    } as unknown as ReturnType<typeof useTraceData>);

    render(<TraceInspector execution={{ id: 'e1', persona_id: 'p1' } as PersonaExecution} />);

    // Errors already counted the unified set; Spans must agree with it.
    expect(screen.getByTestId('trace-span-count')).toHaveTextContent('4');
    expect(screen.getByTestId('trace-error-count')).toHaveTextContent('4');
  });
});
