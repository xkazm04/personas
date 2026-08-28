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

function arrange(errorCount: number) {
  const spans = Array.from({ length: errorCount }, (_, i) => erroredSpan(i));
  mockedUseTraceData.mockReturnValue({
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
