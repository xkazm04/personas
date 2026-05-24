import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useAsyncFieldValidation,
  suggestAlternativeName,
  type AvailabilityResult,
} from '../useAsyncFieldValidation';

describe('useAsyncFieldValidation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts idle and goes to checking immediately on change', () => {
    const { result } = renderHook(() =>
      useAsyncFieldValidation({ check: () => ({ available: true }) }),
    );
    expect(result.current.status).toBe('idle');

    act(() => result.current.onChange('Alpha'));
    expect(result.current.status).toBe('checking');
  });

  it('resolves to available after the debounce window', async () => {
    const { result } = renderHook(() =>
      useAsyncFieldValidation({ check: () => ({ available: true }) }),
    );

    act(() => result.current.onChange('Alpha'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(result.current.status).toBe('available');
    expect(result.current.suggestion).toBeUndefined();
  });

  it('resolves to taken and surfaces a suggestion', async () => {
    const { result } = renderHook(() =>
      useAsyncFieldValidation({
        check: (): AvailabilityResult => ({ available: false, suggestion: 'Alpha 2' }),
      }),
    );

    act(() => result.current.onChange('Alpha'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(result.current.status).toBe('taken');
    expect(result.current.suggestion).toBe('Alpha 2');
  });

  it('debounces — only the final value is checked', async () => {
    const check = vi.fn(() => ({ available: true }));
    const { result } = renderHook(() => useAsyncFieldValidation({ check }));

    act(() => result.current.onChange('A'));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.onChange('Ab'));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.onChange('Abc'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith('Abc', expect.any(AbortSignal));
  });

  it('aborts the in-flight check when a newer keystroke supersedes it', async () => {
    const seenSignals: AbortSignal[] = [];
    const check = vi.fn((_v: string, signal: AbortSignal) => {
      seenSignals.push(signal);
      return new Promise<AvailabilityResult>((resolve) => {
        setTimeout(() => resolve({ available: true }), 1000);
      });
    });
    const { result } = renderHook(() => useAsyncFieldValidation({ check }));

    act(() => result.current.onChange('First'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    // First check is now in flight. Type again — should abort it.
    act(() => result.current.onChange('Second'));
    expect(seenSignals[0]?.aborted).toBe(true);
  });

  it('ignores stale results: a superseded check cannot flip status', async () => {
    let resolveFirst: ((r: AvailabilityResult) => void) | undefined;
    const check = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<AvailabilityResult>((res) => { resolveFirst = res; }),
      )
      .mockImplementationOnce(() => ({ available: true }));

    const { result } = renderHook(() => useAsyncFieldValidation({ check }));

    act(() => result.current.onChange('First'));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    // Supersede with a second value that resolves available.
    act(() => result.current.onChange('Second'));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(result.current.status).toBe('available');

    // The stale first check resolves late as "taken" — must be ignored.
    await act(async () => { resolveFirst?.({ available: false }); });
    expect(result.current.status).toBe('available');
  });

  it('resets to idle below minLength', async () => {
    const { result } = renderHook(() =>
      useAsyncFieldValidation({ check: () => ({ available: true }), minLength: 3 }),
    );

    act(() => result.current.onChange('ab'));
    expect(result.current.status).toBe('idle');

    act(() => result.current.onChange('abc'));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(result.current.status).toBe('available');
  });

  it('falls back to idle (never blocks) when the check throws', async () => {
    const { result } = renderHook(() =>
      useAsyncFieldValidation({
        check: () => {
          throw new Error('IPC failed');
        },
      }),
    );

    act(() => result.current.onChange('Alpha'));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(result.current.status).toBe('idle');
  });

  it('reset() returns to idle and cancels pending work', async () => {
    const check = vi.fn(() => ({ available: true }));
    const { result } = renderHook(() => useAsyncFieldValidation({ check }));

    act(() => result.current.onChange('Alpha'));
    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');

    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(check).not.toHaveBeenCalled();
  });
});

describe('suggestAlternativeName', () => {
  it('returns "{base} 2" when only the base is taken', () => {
    expect(suggestAlternativeName('Sales', ['Sales'])).toBe('Sales 2');
  });

  it('skips taken numbered variants', () => {
    expect(suggestAlternativeName('Sales', ['Sales', 'Sales 2', 'Sales 3'])).toBe('Sales 4');
  });

  it('is case-insensitive and trims', () => {
    expect(suggestAlternativeName('Sales', ['  sales  ', 'SALES 2'])).toBe('Sales 3');
  });
});
