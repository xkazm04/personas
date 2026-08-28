import { describe, it, expect } from 'vitest';
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import { buildSpanTree, flattenTree } from '../traceHelpers';

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

function depths(spans: UnifiedSpan[]): Record<string, number> {
  return Object.fromEntries(
    flattenTree(buildSpanTree(spans)).map((n) => [n.span.span_id, n.depth]),
  );
}

describe('buildSpanTree depth', () => {
  it('indents a nested chain correctly when spans arrive parent-first', () => {
    expect(depths([span('a', null), span('b', 'a'), span('c', 'b')])).toEqual({ a: 0, b: 1, c: 2 });
  });

  it('indents the same chain correctly when spans arrive child-first', () => {
    // The regression this pins: depth was assigned during the linking pass
    // (`node.depth = parent.depth + 1`), which read the parent's depth at that
    // moment. Processing `c` before `b` saw `b.depth` still at its initialised
    // 0, so `c` resolved to 1 and rendered as its own parent's sibling.
    expect(depths([span('c', 'b'), span('b', 'a'), span('a', null)])).toEqual({ a: 0, b: 1, c: 2 });
  });

  it('is order-independent for a wide, deep tree', () => {
    const built = [
      span('root', null),
      span('l1', 'root'),
      span('l2', 'l1'),
      span('l3', 'l2'),
      span('sib', 'l1'),
    ];
    expect(depths([...built].reverse())).toEqual(depths(built));
  });
});

describe('buildSpanTree orphans', () => {
  it('flags a span whose parent is not in the trace instead of silently promoting it', () => {
    // The backend evicts the oldest completed non-root span once a trace passes
    // its 10,000-span ceiling (src-tauri/core/src/trace.rs), and that is
    // routinely a parent — so its children arrive with an unresolvable
    // parent_span_id in exactly the large traces where structure matters.
    const tree = buildSpanTree([span('root', null), span('stray', 'evicted-parent')]);
    const byId = Object.fromEntries(tree.map((n) => [n.span.span_id, n]));
    expect(tree).toHaveLength(2);
    expect(byId.root!.orphaned).toBe(false);
    expect(byId.stray!.orphaned).toBe(true);
    expect(byId.stray!.depth).toBe(0);
  });

  it('does not flag a real root', () => {
    expect(buildSpanTree([span('root', null)])[0]!.orphaned).toBe(false);
  });

  it('does not flag a child whose parent is present', () => {
    const flat = flattenTree(buildSpanTree([span('a', null), span('b', 'a')]));
    expect(flat.every((n) => !n.orphaned)).toBe(true);
  });
});
