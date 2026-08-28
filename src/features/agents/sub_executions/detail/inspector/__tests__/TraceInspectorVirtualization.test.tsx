import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PersonaExecution } from '@/lib/types/types';
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import type { SpanNode } from '../traceInspectorTypes';

vi.mock('../useTraceData', () => ({ useTraceData: vi.fn() }));

import { useTraceData } from '../useTraceData';
import { TraceInspector } from '../TraceInspector';

const mockedUseTraceData = vi.mocked(useTraceData);

function span(i: number): UnifiedSpan {
  return {
    span_id: `s${i}`,
    parent_span_id: null,
    span_type: 'tool_call',
    name: `step-${i}`,
    start_ms: i,
    end_ms: i + 1,
    duration_ms: 1,
    cost_usd: null,
    error: null,
    metadata: null,
  } as UnifiedSpan;
}

function arrange(count: number) {
  const spans = Array.from({ length: count }, (_, i) => span(i));
  const visibleNodes: SpanNode[] = spans.map((s) => ({ span: s, children: [], depth: 0 }));
  mockedUseTraceData.mockReturnValue({
    droppedSpanEvents: 0,
    spanEventBufferCap: 10_000,
    trace: null,
    unifiedTrace: { executionId: 'e1', spans, startedAt: 0, completedAt: count },
    loading: false,
    error: null,
    retry: vi.fn(),
    collapsedSpans: new Set<string>(),
    toggleSpan: vi.fn(),
    visibleNodes,
    totalMs: count,
    childrenMap: new Map<string, boolean>(),
  } as unknown as ReturnType<typeof useTraceData>);

  render(<TraceInspector execution={{ id: 'e1', persona_id: 'p1' } as PersonaExecution} />);
}

describe('TraceInspector waterfall virtualization', () => {
  beforeEach(() => mockedUseTraceData.mockReset());

  it('renders every row directly for a small trace (no virtualization overhead)', () => {
    arrange(12);
    expect(screen.getAllByTestId('trace-span-row')).toHaveLength(12);
  });

  it('creates only a bounded window of rows for a trace at the tracer ceiling', () => {
    // The tracer's ceiling is 10,000 spans and every live span event rebuilds
    // the unified trace, so an unvirtualized map paid full React reconcile
    // across all rows per event. Only the on-screen window may exist in DOM.
    arrange(5000);
    const rows = screen.getAllByTestId('trace-span-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(200);
  });
});
