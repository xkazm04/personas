import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFieldValidation } from '../useFieldValidation';

// invokeWithTimeout rejects with a serialized AppError OBJECT ({error, kind}),
// never an Error; the hook must surface its text, not "[object Object]".
describe('useFieldValidation with an AppError rejection', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the backend reason', async () => {
    vi.useFakeTimers();
    const validate = vi.fn().mockRejectedValue({ error: 'Name already taken', kind: 'validation' });
    const { result } = renderHook(() => useFieldValidation({ validate, debounceMs: 10 }));
    act(() => result.current.onChange('abc'));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(result.current.validationState).toBe('error');
    expect(result.current.error).toBe('Name already taken');
  });
});
