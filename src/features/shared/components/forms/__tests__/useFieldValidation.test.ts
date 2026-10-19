import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFieldValidation } from '../useFieldValidation';

/** A validator whose answers the test releases by hand, in any order. */
function deferredValidator() {
  const pending = new Map<string, (r: string | null) => void>();
  const validate = vi.fn(
    (value: string) => new Promise<string | null>((resolve) => pending.set(value, resolve)),
  );
  return { validate, settle: (value: string, r: string | null) => pending.get(value)!(r) };
}

describe('useFieldValidation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops a verdict for a value the user has already edited past', async () => {
    const v = deferredValidator();
    const { result } = renderHook(() => useFieldValidation({ validate: v.validate, debounceMs: 100 }));

    act(() => result.current.onChange('ab'));
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(v.validate).toHaveBeenCalledWith('ab');

    // The user keeps typing; the new value's debounce window is still open
    // when the OLD check answers.
    act(() => result.current.onChange('abc'));
    await act(async () => { v.settle('ab', 'Too short'); });
    expect(result.current.validationState).toBe('validating');
    expect(result.current.error).toBeUndefined();
  });

  it('does not let an in-flight verdict repaint a field cleared below minLength', async () => {
    const v = deferredValidator();
    const { result } = renderHook(() =>
      useFieldValidation({ validate: v.validate, debounceMs: 100, minLength: 2 }),
    );
    act(() => result.current.onChange('ab'));
    await act(async () => { vi.advanceTimersByTime(100); });
    act(() => result.current.onChange('a'));
    await act(async () => { v.settle('ab', 'Taken'); });
    expect(result.current.validationState).toBe('idle');
    expect(result.current.error).toBeUndefined();
  });

  it('still reports the verdict for the current value', async () => {
    const v = deferredValidator();
    const { result } = renderHook(() => useFieldValidation({ validate: v.validate, debounceMs: 100 }));
    act(() => result.current.onChange('abc'));
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => { v.settle('abc', 'Taken'); });
    expect(result.current.validationState).toBe('error');
    expect(result.current.error).toBe('Taken');
  });
});
