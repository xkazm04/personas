import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { FINAL_STAGE, useStagedMount, _resetStagedMountForTests } from '../useStagedMount';

beforeEach(() => {
  _resetStagedMountForTests();
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useStagedMount', () => {
  it('climbs one stage per animation frame on the first mount', () => {
    const { result } = renderHook(() => useStagedMount());
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(result.current).toBe(1);
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(result.current).toBe(FINAL_STAGE);
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(result.current).toBe(FINAL_STAGE);
  });

  it('starts at the final stage on every mount after the first full paint', () => {
    const first = renderHook(() => useStagedMount());
    act(() => { vi.advanceTimersToNextFrame(); });
    act(() => { vi.advanceTimersToNextFrame(); });
    first.unmount();

    const second = renderHook(() => useStagedMount());
    expect(second.result.current).toBe(FINAL_STAGE);
  });

  it('an unmount mid-climb does not mark the board painted', () => {
    const first = renderHook(() => useStagedMount());
    act(() => { vi.advanceTimersToNextFrame(); });
    first.unmount();
    const second = renderHook(() => useStagedMount());
    expect(second.result.current).toBe(0);
  });
});
