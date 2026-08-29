import { describe, it, expect } from 'vitest';
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { SpanNode } from '../traceInspectorTypes';
import { applySpanEvent, buildParentIndex, computeVisibleNodes } from '../traceInspectorTypes';
import { waterfallGeometry } from '../WaterfallBar';
import { durationColor } from '../inspectorTypes';

function span(id: string, parent: string | null, over: Partial<UnifiedSpan> = {}): UnifiedSpan {
  return {
    span_id: id,
    parent_span_id: parent,
    span_type: 'tool_call',
    name: id,
    start_ms: 0,
    end_ms: 1,
    duration_ms: 1,
    cost_usd: null,
    error: null,
    metadata: null,
    ...over,
  } as UnifiedSpan;
}

function backendSpan(id: string, over: Partial<TraceSpan> = {}): TraceSpan {
  return {
    span_id: id,
    parent_span_id: null,
    span_type: 'tool_call',
    name: id,
    start_ms: 0,
    end_ms: null,
    duration_ms: null,
    cost_usd: null,
    error: null,
    metadata: null,
    ...over,
  } as TraceSpan;
}

/** Flat node list in the shape `computeVisibleNodes` consumes. */
function nodes(spans: UnifiedSpan[]): SpanNode[] {
  return spans.map((s) => ({ span: s, children: [], depth: 0, orphaned: false }));
}

function visibleIds(spans: UnifiedSpan[], collapsed: string[]): string[] {
  return computeVisibleNodes(nodes(spans), new Set(collapsed), buildParentIndex(spans))
    .map((n) => n.span.span_id);
}

describe('buildParentIndex', () => {
  it('maps every span to its parent, with null for roots', () => {
    const index = buildParentIndex([span('root', null), span('a', 'root'), span('b', 'a')]);
    expect(index.get('root')).toBeNull();
    expect(index.get('a')).toBe('root');
    expect(index.get('b')).toBe('a');
    expect(index.size).toBe(3);
  });

  it('normalises an undefined parent to null', () => {
    const index = buildParentIndex([span('root', undefined as unknown as null)]);
    expect(index.get('root')).toBeNull();
  });

  it('lets the FIRST occurrence of a colliding span id own the parent link', () => {
    // Two events reporting one span id are two distinct calls that collided,
    // not one call seen twice. Producers batch and retry, so arrival order
    // must not decide where the children of that id hang.
    const seenAsChildOfRoot = [span('root', null), span('a', 'root'), span('dup', 'root'), span('dup', 'a')];
    const sameEventsReordered = [span('root', null), span('a', 'root'), span('dup', 'a'), span('dup', 'root')];
    expect(buildParentIndex(seenAsChildOfRoot).get('dup')).toBe('root');
    expect(buildParentIndex(sameEventsReordered).get('dup')).toBe('a');
    // ...and the collision does not inflate the index: still one entry per id.
    expect(buildParentIndex(seenAsChildOfRoot).size).toBe(3);
  });
});

describe('computeVisibleNodes', () => {
  //  root > a > b > c
  const spans = [span('root', null), span('a', 'root'), span('b', 'a'), span('c', 'b')];

  it('returns the input list by reference when nothing is collapsed', () => {
    const all = nodes(spans);
    expect(computeVisibleNodes(all, new Set(), buildParentIndex(spans))).toBe(all);
  });

  it('keeps a collapsed span itself visible — only its descendants hide', () => {
    expect(visibleIds(spans, ['root'])).toEqual(['root']);
  });

  it('hides the child of a directly collapsed parent', () => {
    expect(visibleIds(spans, ['b'])).toEqual(['root', 'a', 'b']);
  });

  it('hides deep descendants of a collapsed grandparent', () => {
    expect(visibleIds(spans, ['a'])).toEqual(['root', 'a']);
  });

  it('does not hide a sibling branch', () => {
    const siblings = [span('root', null), span('a', 'root'), span('x', 'root')];
    expect(visibleIds(siblings, ['a'])).toEqual(['root', 'a', 'x']);
  });

  it('terminates on a malformed parent cycle', () => {
    // A non-empty collapsed set is what forces the walk to actually run —
    // an empty one short-circuits before the cycle guard is ever reached.
    const cyclic = [span('p', 'q'), span('q', 'p')];
    expect(visibleIds(cyclic, ['unrelated'])).toEqual(['p', 'q']);
  });
});

describe('applySpanEvent', () => {
  it('appends a span on its start event', () => {
    const next = applySpanEvent([], backendSpan('s1'), 'start');
    expect(next.map((s) => s.span_id)).toEqual(['s1']);
  });

  it('replaces the existing row on end', () => {
    const prev = [backendSpan('s1')];
    const next = applySpanEvent(prev, backendSpan('s1', { duration_ms: 42 }), 'end');
    expect(next).toHaveLength(1);
    expect(next[0]!.duration_ms).toBe(42);
  });

  it('keeps an end event whose start was never seen', () => {
    // The regression this guards: an `end` with no existing row used to be
    // dropped, so the span vanished from the live trace entirely.
    const next = applySpanEvent([backendSpan('other')], backendSpan('s1', { duration_ms: 7 }), 'end');
    expect(next.map((s) => s.span_id)).toEqual(['other', 's1']);
    expect(next[1]!.duration_ms).toBe(7);
  });

  it('ignores a duplicate start and returns the same array', () => {
    const prev = [backendSpan('s1')];
    expect(applySpanEvent(prev, backendSpan('s1'), 'start')).toBe(prev);
  });

  it('ignores unknown event types and returns the same array', () => {
    const prev = [backendSpan('s1')];
    expect(applySpanEvent(prev, backendSpan('s2'), 'progress')).toBe(prev);
  });

  it('does not mutate the previous array', () => {
    const prev = [backendSpan('s1')];
    applySpanEvent(prev, backendSpan('s2'), 'start');
    expect(prev).toHaveLength(1);
  });
});

describe('waterfallGeometry', () => {
  it('maps a span onto its share of the track', () => {
    expect(waterfallGeometry(250, 500, 1000)).toEqual({ leftPct: 25, widthPct: 50 });
  });

  it('fills to the end of the track when duration is unknown', () => {
    expect(waterfallGeometry(400, null, 1000)).toEqual({ leftPct: 40, widthPct: 60 });
  });

  it('gives a zero-duration span a minimum visible width', () => {
    expect(waterfallGeometry(0, 0, 1000).widthPct).toBe(0.5);
  });

  it('clamps a negative start to the track origin', () => {
    // Clock skew between the pipeline and backend traces can produce this.
    expect(waterfallGeometry(-500, 100, 1000).leftPct).toBe(0);
  });

  it('never lets left + width exceed the track', () => {
    const wide = waterfallGeometry(900, 5000, 1000);
    expect(wide.leftPct + wide.widthPct).toBeLessThanOrEqual(100);

    const late = waterfallGeometry(4000, 100, 1000);
    expect(late.leftPct).toBeLessThanOrEqual(99.5);
    expect(late.leftPct + late.widthPct).toBeLessThanOrEqual(100);
  });
});

describe('durationColor', () => {
  it('is neutral when the duration is unknown', () => {
    expect(durationColor(null)).toContain('bg-secondary');
    expect(durationColor(undefined)).toContain('bg-secondary');
  });

  it('is green below the 2s tier boundary', () => {
    expect(durationColor(0)).toContain('emerald');
    expect(durationColor(1999)).toContain('emerald');
  });

  it('is amber from 2s up to the 10s boundary', () => {
    expect(durationColor(2000)).toContain('amber');
    expect(durationColor(9999)).toContain('amber');
  });

  it('is red from 10s up', () => {
    expect(durationColor(10000)).toContain('red');
    expect(durationColor(120000)).toContain('red');
  });
});
