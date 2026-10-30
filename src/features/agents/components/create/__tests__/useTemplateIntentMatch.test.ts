import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockMatch = vi.fn();
vi.mock('@/api/companion', () => ({
  companionMatchTemplates: (...args: unknown[]) => mockMatch(...args),
}));

import { useTemplateIntentMatch } from '../useTemplateIntentMatch';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('useTemplateIntentMatch - latest keystroke wins', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMatch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops an older response that lands after a newer one', async () => {
    const older = deferred<{ id: string; name: string }[]>();
    const newer = deferred<{ id: string; name: string }[]>();
    mockMatch.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const { result, rerender } = renderHook(({ intent }) => useTemplateIntentMatch(intent), {
      initialProps: { intent: 'triage my inbox' },
    });
    await act(async () => { vi.advanceTimersByTime(300); });
    rerender({ intent: 'triage my inbox daily' });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(mockMatch).toHaveBeenCalledTimes(2);

    await act(async () => { newer.resolve([{ id: 'new', name: 'Newer' }]); });
    await act(async () => { older.resolve([{ id: 'old', name: 'Older' }]); });

    expect(result.current.matches.map((m) => m.id)).toEqual(['new']);
    expect(result.current.loading).toBe(false);
  });

  it('a short intent clears matches and supersedes an in-flight request', async () => {
    const pending = deferred<{ id: string; name: string }[]>();
    mockMatch.mockReturnValueOnce(pending.promise);

    const { result, rerender } = renderHook(({ intent }) => useTemplateIntentMatch(intent), {
      initialProps: { intent: 'triage my inbox' },
    });
    await act(async () => { vi.advanceTimersByTime(300); });
    rerender({ intent: 'tri' });
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { pending.resolve([{ id: 'late', name: 'Late' }]); });

    expect(result.current.matches).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // Round 2 card 12: during the 300ms debounce the hook reported idle, so the
  // roster's first-run field painted its no-match Create button, hid it when
  // the request started, then painted matches - three states in ~0.5s.
  it('reports pending from the keystroke, not from the debounced request', async () => {
    const pending = deferred<{ id: string; name: string }[]>();
    mockMatch.mockReturnValueOnce(pending.promise);

    const { result, rerender } = renderHook(({ intent }) => useTemplateIntentMatch(intent), {
      initialProps: { intent: '' },
    });
    expect(result.current.loading).toBe(false);

    rerender({ intent: 'summarize my inbox' });
    // Inside the debounce window: no request yet, but a match is coming.
    expect(mockMatch).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    await act(async () => { vi.advanceTimersByTime(300); });
    expect(result.current.loading).toBe(true);
    await act(async () => { pending.resolve([{ id: 'm', name: 'Match' }]); });
    expect(result.current.loading).toBe(false);
    expect(result.current.matches.map((m) => m.id)).toEqual(['m']);

    // A short intent is never pending: there is nothing to wait for.
    rerender({ intent: 'sum' });
    expect(result.current.loading).toBe(false);
  });
});
