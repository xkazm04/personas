import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { PersonaExecution } from '@/lib/types/types';
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import type { SpanNode } from '../traceInspectorTypes';

vi.mock('../useTraceData', () => ({ useTraceData: vi.fn() }));

import { useTraceData } from '../useTraceData';
import { TraceInspector } from '../TraceInspector';

const mockedUseTraceData = vi.mocked(useTraceData);

const ROW_HEIGHT = 32;

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
  // Every row has children, so every row carries the expand/collapse button a
  // keyboard user tabs to.
  const childrenMap = new Map<string, boolean>(spans.map((s) => [s.span_id, true]));
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
    childrenMap,
  } as unknown as ReturnType<typeof useTraceData>);

  render(<TraceInspector execution={{ id: 'e1', persona_id: 'p1' } as PersonaExecution} />);
}

function scrollTo(el: HTMLElement, top: number) {
  // jsdom has no layout, so scrollTop is pinned to the value we give it.
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: top, writable: true });
  fireEvent.scroll(el);
}

describe('TraceInspector waterfall keeps the focused row mounted', () => {
  beforeEach(() => mockedUseTraceData.mockReset());

  it('a toggle that has keyboard focus survives scrolling out of the window', async () => {
    arrange(5000);
    const toggle = screen.getByRole('button', { name: 'step-0' });
    const scroller = toggle.closest<HTMLElement>('[class*="overflow-y-auto"]');
    expect(scroller).not.toBeNull();

    act(() => toggle.focus());
    expect(document.activeElement).toBe(toggle);

    // Row 0 leaves the window and its overscan: 2,000 rows down.
    await act(async () => scrollTo(scroller!, 2000 * ROW_HEIGHT));

    // The window moved - a row near the new offset exists ...
    expect(screen.getByRole('button', { name: 'step-2000' })).toBeInTheDocument();
    // ... the created set is still bounded ...
    expect(screen.getAllByTestId('trace-span-row').length).toBeLessThan(200);
    // ... and focus did not fall back to the document.
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('button', { name: 'step-0' })).toBe(document.activeElement);
  });

  it('focus leaving the list releases the row on the next scroll', async () => {
    arrange(5000);
    const toggle = screen.getByRole('button', { name: 'step-0' });
    const scroller = toggle.closest<HTMLElement>('[class*="overflow-y-auto"]');
    const outside = document.createElement('button');
    document.body.appendChild(outside);

    act(() => toggle.focus());
    act(() => outside.focus());
    await act(async () => scrollTo(scroller!, 2000 * ROW_HEIGHT));

    expect(screen.queryByRole('button', { name: 'step-0' })).toBeNull();
    outside.remove();
  });

  it('a row with no focus still leaves the window', async () => {
    arrange(5000);
    const scroller = screen
      .getByRole('button', { name: 'step-0' })
      .closest<HTMLElement>('[class*="overflow-y-auto"]');

    await act(async () => scrollTo(scroller!, 2000 * ROW_HEIGHT));

    expect(screen.queryByRole('button', { name: 'step-0' })).toBeNull();
  });
});
