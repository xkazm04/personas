import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModalStack } from '../useModalStack';

type Entry =
  | { type: 'detail'; id: string }
  | { type: 'preview'; id: string };

describe('useModalStack', () => {
  it('shows the template opened last when a second detail is pushed over the first', () => {
    const { result } = renderHook(() => useModalStack<Entry>());
    act(() => result.current.open({ type: 'detail', id: 'a' }));
    // The trending shelf sits outside the list-scoped detail modal and stays
    // clickable, so a second 'detail' entry lands while the first is open.
    act(() => result.current.open({ type: 'detail', id: 'b' }));
    expect(result.current.find('detail')?.id).toBe('b');
  });

  it('returns to the parent entry when the newest one closes', () => {
    const { result } = renderHook(() => useModalStack<Entry>());
    act(() => result.current.open({ type: 'detail', id: 'a' }));
    act(() => result.current.open({ type: 'detail', id: 'b' }));
    act(() => result.current.close('detail'));
    expect(result.current.find('detail')?.id).toBe('a');
    act(() => result.current.close('detail'));
    expect(result.current.isOpen('detail')).toBe(false);
  });

  it('finds an entry of another type under the top one', () => {
    const { result } = renderHook(() => useModalStack<Entry>());
    act(() => result.current.open({ type: 'preview', id: 'p' }));
    act(() => result.current.open({ type: 'detail', id: 'a' }));
    expect(result.current.find('preview')?.id).toBe('p');
  });
});
