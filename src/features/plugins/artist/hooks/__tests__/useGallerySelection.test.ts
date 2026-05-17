import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGallerySelection } from '../useGallerySelection';

interface Item {
  id: string;
}
const A: Item = { id: 'a' };
const B: Item = { id: 'b' };
const C: Item = { id: 'c' };
const D: Item = { id: 'd' };

describe('useGallerySelection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useGallerySelection([A, B, C]));
    expect(result.current.count).toBe(0);
    expect(result.current.isSelected('a')).toBe(false);
  });

  it('toggles a single id on and off', () => {
    const { result } = renderHook(() => useGallerySelection([A, B, C]));
    act(() => result.current.toggle('a', 0, false));
    expect(result.current.isSelected('a')).toBe(true);
    expect(result.current.count).toBe(1);

    act(() => result.current.toggle('a', 0, false));
    expect(result.current.isSelected('a')).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it('toggles two different ids independently', () => {
    const { result } = renderHook(() => useGallerySelection([A, B, C]));
    act(() => result.current.toggle('a', 0, false));
    act(() => result.current.toggle('c', 2, false));
    expect(result.current.count).toBe(2);
    expect(result.current.isSelected('a')).toBe(true);
    expect(result.current.isSelected('c')).toBe(true);
    expect(result.current.isSelected('b')).toBe(false);
  });

  it('shift-toggle from anchor selects every id in the range', () => {
    const { result } = renderHook(() => useGallerySelection([A, B, C, D]));
    // First toggle sets anchor at index 0.
    act(() => result.current.toggle('a', 0, false));
    // Shift-toggle at index 3 should add b, c, d to the selection.
    act(() => result.current.toggle('d', 3, true));
    expect(result.current.count).toBe(4);
    expect(['a', 'b', 'c', 'd'].every((id) => result.current.isSelected(id))).toBe(true);
  });

  it('shift-toggle works in reverse direction (anchor higher than target)', () => {
    const { result } = renderHook(() => useGallerySelection([A, B, C, D]));
    act(() => result.current.toggle('d', 3, false));
    act(() => result.current.toggle('a', 0, true));
    expect(result.current.count).toBe(4);
  });

  it('shift-toggle without a prior anchor falls back to plain toggle', () => {
    const { result } = renderHook(() => useGallerySelection([A, B, C]));
    // lastIndex is null on first call regardless of shift.
    act(() => result.current.toggle('b', 1, true));
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected('b')).toBe(true);
  });

  it('clears the selection', () => {
    const { result } = renderHook(() => useGallerySelection([A, B, C]));
    act(() => result.current.toggle('a', 0, false));
    act(() => result.current.toggle('b', 1, false));
    expect(result.current.count).toBe(2);
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });

  it('prunes selection when an item disappears from the list', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: Item[] }) => useGallerySelection(items),
      { initialProps: { items: [A, B, C] } },
    );
    act(() => result.current.toggle('a', 0, false));
    act(() => result.current.toggle('b', 1, false));
    expect(result.current.count).toBe(2);

    // Filter narrows the visible set; 'a' is no longer visible.
    rerender({ items: [B, C] });
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected('a')).toBe(false);
    expect(result.current.isSelected('b')).toBe(true);
  });

  it('does not change selection identity when items rerender but all selected ids still present', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: Item[] }) => useGallerySelection(items),
      { initialProps: { items: [A, B, C] } },
    );
    act(() => result.current.toggle('a', 0, false));
    const before = result.current.selectedIds;
    // New array, same ids — the prune branch should bail with `return prev`.
    rerender({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    expect(result.current.selectedIds).toBe(before);
  });

  it('shift-range after a soft skip still pivots from the most recent click', () => {
    const { result } = renderHook(() => useGallerySelection([A, B, C, D]));
    act(() => result.current.toggle('a', 0, false));   // anchor 0
    act(() => result.current.toggle('c', 2, false));   // anchor moves to 2
    act(() => result.current.toggle('d', 3, true));    // range 2..3 → adds d (c stays)
    expect(result.current.isSelected('a')).toBe(true);
    expect(result.current.isSelected('b')).toBe(false);
    expect(result.current.isSelected('c')).toBe(true);
    expect(result.current.isSelected('d')).toBe(true);
  });
});
