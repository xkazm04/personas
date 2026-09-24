/**
 * The 10s pop-up lifetime: each message expires on its own clock, overlapping
 * ones stack and leave one by one, and holding the island open pauses every
 * clock without eating the time a message had left.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_LIFETIME_MS, type LiveMessage } from '../liveModel';
import { useLiveLifetimes } from '../useLiveLifetimes';

const msg = (id: string) => ({ id }) as LiveMessage;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(initial: LiveMessage[]) {
  const expire = vi.fn();
  const hook = renderHook(({ live }) => useLiveLifetimes(live, expire), { initialProps: { live: initial } });
  return { expire, hook };
}

describe('useLiveLifetimes', () => {
  it('expires a message at its lifetime, not before', () => {
    const { expire } = setup([msg('a')]);
    act(() => { vi.advanceTimersByTime(LIVE_LIFETIME_MS - 200); });
    expect(expire).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(expire).toHaveBeenCalledWith(new Set(['a']));
  });

  it('overlapping messages keep their own clocks', () => {
    const { expire, hook } = setup([msg('a')]);
    act(() => { vi.advanceTimersByTime(4_000); });
    hook.rerender({ live: [msg('b'), msg('a')] });
    act(() => { vi.advanceTimersByTime(6_100); });
    expect(expire).toHaveBeenLastCalledWith(new Set(['a']));
    hook.rerender({ live: [msg('b')] });
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(expire).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1_100); });
    expect(expire).toHaveBeenLastCalledWith(new Set(['b']));
  });

  it('holding pauses the clock and resumes it with the time that was left', () => {
    const { expire, hook } = setup([msg('a')]);
    act(() => { vi.advanceTimersByTime(8_000); });
    act(() => { hook.result.current.onHoldChange(true); });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(expire).not.toHaveBeenCalled();
    act(() => { hook.result.current.onHoldChange(false); });
    act(() => { vi.advanceTimersByTime(1_800); });
    expect(expire).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(expire).toHaveBeenCalledWith(new Set(['a']));
  });
});
