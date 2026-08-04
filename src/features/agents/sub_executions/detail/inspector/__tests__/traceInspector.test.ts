import { describe, it, expect } from 'vitest';
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import { buildParentMap, isAncestorCollapsed, mergeSpanEvent } from '../traceVisibility';
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

describe('buildParentMap', () => {
  it('maps every span to its parent, with null for roots', () => {
    const map = buildParentMap([span('root', null), span('a', 'root'), span('b', 'a')]);
    expect(map.get('root')).toBeNull();
    expect(map.get('a')).toBe('root');
    expect(map.get('b')).toBe('a');
    expect(map.size).toBe(3);
  });

  it('normalises an undefined parent to null', () => {
    const map = buildParentMap([span('root', undefined as unknown as null)]);
    expect(map.get('root')).toBeNull();
  });
});

describe('isAncestorCollapsed', () => {
  //  root > a > b > c
  const spans = [span('root', null), span('a', 'root'), span('b', 'a'), span('c', 'b')];
  const map = buildParentMap(spans);

  it('is false when nothing is collapsed', () => {
    expect(isAncestorCollapsed('b', map, new Set())).toBe(false);
  });

  it('is false for a root span (no parent to walk)', () => {
    expect(isAncestorCollapsed(null, map, new Set(['root']))).toBe(false);
  });

  it('hides a child of a directly collapsed parent', () => {
    expect(isAncestorCollapsed('b', map, new Set(['b']))).toBe(true);
  });

  it('hides a deep descendant of a collapsed grandparent', () => {
    // c's parent chain is b -> a -> root; collapsing `a` must hide `c`.
    expect(isAncestorCollapsed('b', map, new Set(['a']))).toBe(true);
    expect(isAncestorCollapsed('b', map, new Set(['root']))).toBe(true);
  });

  it('does not hide a sibling branch', () => {
    const siblings = buildParentMap([span('root', null), span('a', 'root'), span('x', 'root')]);
    expect(isAncestorCollapsed('x', siblings, new Set(['a']))).toBe(false);
  });

  it('terminates on a malformed parent cycle', () => {
    const cyclic = buildParentMap([span('p', 'q'), span('q', 'p')]);
    expect(isAncestorCollapsed('p', cyclic, new Set())).toBe(false);
  });
});

describe('mergeSpanEvent', () => {
  it('appends a span on its start event', () => {
    const next = mergeSpanEvent([], backendSpan('s1'), 'start');
    expect(next.map((s) => s.span_id)).toEqual(['s1']);
  });

  it('replaces the existing row on end', () => {
    const prev = [backendSpan('s1')];
    const next = mergeSpanEvent(prev, backendSpan('s1', { duration_ms: 42 }), 'end');
    expect(next).toHaveLength(1);
    expect(next[0]!.duration_ms).toBe(42);
  });

  it('keeps an end event whose start was never seen', () => {
    // The regression this guards: an `end` with no existing row used to be
    // dropped, so the span vanished from the live trace entirely.
    const next = mergeSpanEvent([backendSpan('other')], backendSpan('s1', { duration_ms: 7 }), 'end');
    expect(next.map((s) => s.span_id)).toEqual(['other', 's1']);
    expect(next[1]!.duration_ms).toBe(7);
  });

  it('ignores a duplicate start and returns the same array', () => {
    const prev = [backendSpan('s1')];
    expect(mergeSpanEvent(prev, backendSpan('s1'), 'start')).toBe(prev);
  });

  it('ignores unknown event types and returns the same array', () => {
    const prev = [backendSpan('s1')];
    expect(mergeSpanEvent(prev, backendSpan('s2'), 'progress')).toBe(prev);
  });

  it('does not mutate the previous array', () => {
    const prev = [backendSpan('s1')];
    mergeSpanEvent(prev, backendSpan('s2'), 'start');
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
