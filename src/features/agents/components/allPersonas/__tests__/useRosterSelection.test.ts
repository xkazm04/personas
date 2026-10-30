import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Persona } from '@/lib/bindings/Persona';
import { useRosterSelection } from '../useRosterSelection';

const all = Array.from({ length: 140 }, (_, i) => ({ id: `p${i}` })) as unknown as Persona[];
const page1 = all.slice(0, 25);

// Round 2 card 14: the header checkbox selected every FILTERED persona while
// the grid showed 25, so Archive (no confirm) acted on 115 unseen rows.
describe('useRosterSelection', () => {
  it('header select-all takes the visible page only, and offers the rest explicitly', () => {
    const { result } = renderHook(() => useRosterSelection(all, page1));
    act(() => result.current.togglePage());
    expect(result.current.selectedIds.size).toBe(25);
    expect(result.current.pageAllSelected).toBe(true);
    expect(result.current.scope).toBe('page');

    act(() => result.current.selectAllMatching());
    expect(result.current.selectedIds.size).toBe(140);
    expect(result.current.scope).toBe('matching');

    act(() => result.current.clear());
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.scope).toBe('none');
  });

  it('a second header click takes the page back out, keeping selections from other pages', () => {
    const { result, rerender } = renderHook(({ visible }) => useRosterSelection(all, visible), {
      initialProps: { visible: page1 },
    });
    act(() => result.current.toggleOne('p100'));
    act(() => result.current.togglePage());
    expect(result.current.selectedIds.size).toBe(26);
    act(() => result.current.togglePage());
    expect([...result.current.selectedIds]).toEqual(['p100']);
    rerender({ visible: all.slice(100, 125) });
    expect(result.current.pageAllSelected).toBe(false);
  });

  it('a single page needs no scope line', () => {
    const few = all.slice(0, 10);
    const { result } = renderHook(() => useRosterSelection(few, few));
    act(() => result.current.togglePage());
    expect(result.current.selectedIds.size).toBe(10);
    expect(result.current.scope).toBe('none');
  });
});
