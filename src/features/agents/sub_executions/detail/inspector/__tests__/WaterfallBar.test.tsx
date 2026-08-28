import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import { WaterfallBar } from '../WaterfallBar';

function span(over: Partial<UnifiedSpan> = {}): UnifiedSpan {
  return {
    span_id: 's1',
    parent_span_id: null,
    span_type: 'tool_call',
    name: 's1',
    start_ms: 0,
    end_ms: 100,
    duration_ms: 100,
    cost_usd: null,
    error: null,
    metadata: null,
    ...over,
  } as UnifiedSpan;
}

describe('WaterfallBar', () => {
  it('marks a still-open span so it cannot read as a finished one', () => {
    // A span with no end and no duration is stretched to the end of the track
    // by waterfallGeometry -- without its own edge treatment it is pixel-for-
    // pixel a span that ran the full trace and completed.
    const { container } = render(
      <WaterfallBar span={span({ end_ms: null, duration_ms: null })} totalMs={1000} />,
    );
    const bar = container.querySelector('[data-span-open="true"]');
    expect(bar).not.toBeNull();
    expect(bar!.className).toContain('border-dashed');
    expect(bar!.className).not.toContain(' rounded ');
  });

  it('renders a closed span as a plain finished bar', () => {
    const { container } = render(<WaterfallBar span={span()} totalMs={1000} />);
    expect(container.querySelector('[data-span-open="true"]')).toBeNull();
  });

  it('renders nothing when the trace has no measured span of time', () => {
    const { container } = render(<WaterfallBar span={span()} totalMs={0} />);
    expect(container.firstChild).toBeNull();
  });
});
