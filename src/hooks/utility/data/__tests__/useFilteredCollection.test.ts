import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFilteredCollection } from '../useFilteredCollection';

interface Row {
  id: number;
  persona_id: string | null;
  source?: string | null;
}

const ROWS: Row[] = [
  { id: 1, persona_id: 'a', source: null },
  { id: 2, persona_id: 'b', source: 'cloud' },
  { id: 3, persona_id: 'a', source: 'cloud' },
];

describe('useFilteredCollection', () => {
  it('filters on exact matchers and skips empty values', () => {
    const { result } = renderHook(() =>
      useFilteredCollection(ROWS, { exact: [{ field: 'persona_id', value: 'a' }] }),
    );
    expect(result.current.filtered.map((r) => r.id)).toEqual([1, 3]);
    expect(result.current.total).toBe(3);
    expect(result.current.isEmpty).toBe(false);

    const { result: unfiltered } = renderHook(() =>
      useFilteredCollection(ROWS, { exact: [{ field: 'persona_id', value: '' }] }),
    );
    expect(unfiltered.current.filtered).toHaveLength(3);
  });

  it('applies the fallback when the field is null', () => {
    const { result } = renderHook(() =>
      useFilteredCollection(ROWS, {
        exact: [{ field: 'source', value: 'local', fallback: 'local' }],
      }),
    );
    expect(result.current.filtered.map((r) => r.id)).toEqual([1]);
  });

  it('keeps a stable result across re-renders with an equivalent inline spec', () => {
    // Every call site passes an object literal, so a dependency on `spec`'s
    // identity would recompute here and hand downstream memos a fresh array.
    const { result, rerender } = renderHook(() =>
      useFilteredCollection(ROWS, { exact: [{ field: 'persona_id', value: 'a' }] }),
    );

    const first = result.current.filtered;
    rerender();
    rerender();
    expect(result.current.filtered).toBe(first);
  });

  it('recomputes when a matcher value actually changes', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string }) =>
        useFilteredCollection(ROWS, { exact: [{ field: 'persona_id', value: v }] }),
      { initialProps: { v: 'a' } },
    );
    expect(result.current.filtered.map((r) => r.id)).toEqual([1, 3]);

    rerender({ v: 'b' });
    expect(result.current.filtered.map((r) => r.id)).toEqual([2]);
  });

  it('does not re-run stable custom predicates on a bare re-render', () => {
    const predicate = vi.fn((r: Row) => r.id !== 2);

    const { result, rerender } = renderHook(() =>
      useFilteredCollection(ROWS, { custom: [predicate] }),
    );
    expect(result.current.filtered.map((r) => r.id)).toEqual([1, 3]);
    const callsAfterFirst = predicate.mock.calls.length;

    rerender();
    expect(predicate.mock.calls.length).toBe(callsAfterFirst);
  });

  it('recomputes when a custom predicate identity changes', () => {
    const { result, rerender } = renderHook(
      ({ p }: { p: (r: Row) => boolean }) => useFilteredCollection(ROWS, { custom: [p] }),
      { initialProps: { p: (r: Row) => r.id !== 2 } },
    );
    expect(result.current.filtered.map((r) => r.id)).toEqual([1, 3]);

    rerender({ p: (r: Row) => r.id === 2 });
    expect(result.current.filtered.map((r) => r.id)).toEqual([2]);
  });
});
