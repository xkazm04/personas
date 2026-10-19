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
});
