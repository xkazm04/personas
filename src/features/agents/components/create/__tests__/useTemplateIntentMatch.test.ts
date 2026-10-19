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
});
