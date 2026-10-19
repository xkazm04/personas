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
});
