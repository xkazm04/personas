import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDebouncedSave } from '../useDebouncedSave';
import { useToastStore } from '@/stores/toastStore';

/**
 * The debounced auto-save primitive behind the persona editor tabs, the
 * contest review draft and notification settings. Three properties a caller
 * cannot see from outside and therefore cannot compensate for.
 */
describe('useDebouncedSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the backend reason when an IPC save rejects with an AppError object', async () => {
    // invokeWithTimeout rejects with a serialized AppError, never an Error.
    const saveFn = vi.fn().mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    const { result } = renderHook(() => useDebouncedSave(saveFn, true, ['v1'], 100));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(result.current.lastError).toBe('database is locked');
    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast?.message).toContain('database is locked');
  });

  it('reports a failed unmount flush instead of leaving an unhandled rejection', async () => {
    const saveFn = vi.fn().mockRejectedValue({ error: 'disk full', kind: 'Io' });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { unmount } = renderHook(() => useDebouncedSave(saveFn, true, ['v1'], 800));
      // Unmount inside the debounce window: the pending edit is flushed.
      unmount();
      expect(saveFn).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // Let Node's unhandled-rejection tracker run.
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
      const toast = useToastStore.getState().toasts.at(-1);
      expect(toast?.message).toContain('disk full');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('lands overlapping saves in edit order, so the newer value is the one that persists', async () => {
    const persisted: string[] = [];
    let current = 'v1';
    // The first write is slow, the second fast: unserialized, v1 lands last.
    const saveFn = vi.fn(async () => {
      const value = current;
      await new Promise((r) => setTimeout(r, value === 'v1' ? 300 : 10));
      persisted.push(value);
    });

    const { rerender } = renderHook(
      ({ value }) => useDebouncedSave(saveFn, true, [value], 50),
      { initialProps: { value: 'v1' } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // v1 save starts (300 ms)
    });
    current = 'v2';
    rerender({ value: 'v2' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50); // v2 save is due while v1 is in flight
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(persisted).toEqual(['v1', 'v2']);
  });
});
