/**
 * The announcing side (/perfect wave 2, direction 6): a re-delivered read announces nothing, a seen entry never comes
 * back, a change this sheet caused is not news, and a burst is one state update that flashes the plan once.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanSnapshot } from '@/lib/lensScan/wire';
import { useChanges } from '../controller/useChanges';
import { FLASH_MS } from '../engine/changed';
import { kettleScan } from '../fixture/kettle';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const moved = (ids: string[], to: 'approved' | 'declined' | 'proposed'): ScanSnapshot => {
  const s = kettleScan();
  for (const p of s.proposals) if (ids.includes(p.id)) p.status = to;
  return s;
};
const waiting = () => kettleScan().proposals.filter((p) => p.status === 'proposed').map((p) => p.id);

function mount(engine: { flash: (f: Iterable<string>) => void } | null = null) {
  return renderHook(({ scan }) => useChanges(scan, engine), { initialProps: { scan: kettleScan() } });
}

describe('useChanges', () => {
  it('the first scan is the baseline and an identical re-delivery announces nothing', () => {
    const flash = vi.fn();
    const h = mount({ flash });
    expect(h.result.current.pending).toEqual([]);
    h.rerender({ scan: kettleScan() });
    expect(h.result.current.pending).toEqual([]);
    expect(flash).not.toHaveBeenCalled();
  });

  it('a burst is one update that flashes the plan once and lights the queue rows, which then settle', () => {
    const flash = vi.fn();
    const h = mount({ flash });
    const ids = waiting().slice(0, 3);
    h.rerender({ scan: moved(ids, 'approved') });
    expect(h.result.current.pending).toHaveLength(3);
    expect(flash).toHaveBeenCalledTimes(1);
    expect([...flash.mock.calls[0]![0]].length).toBeGreaterThan(0);
    expect([...h.result.current.fresh].sort()).toEqual([...ids].sort());
    act(() => { vi.advanceTimersByTime(FLASH_MS + 10); });
    expect(h.result.current.fresh.size).toBe(0);
  });

  it('a seen entry is never announced again, even when the store flips back and forth', () => {
    const h = mount();
    const [id] = waiting();
    h.rerender({ scan: moved([id!], 'approved') });
    expect(h.result.current.pending).toHaveLength(1);
    act(() => h.result.current.markSeen());
    expect(h.result.current.pending).toHaveLength(0);
    h.rerender({ scan: kettleScan() });
    h.rerender({ scan: moved([id!], 'approved') });
    // the flip back is a new event and is announced; the approval already seen is not
    expect(h.result.current.pending.map((c) => c.key)).toEqual([`p:${id}:proposed`]);
  });

  it('a change this sheet caused is not announced, and the next one on the same id is', () => {
    const h = mount();
    const [id, other] = waiting();
    act(() => h.result.current.sent([id!]));
    h.rerender({ scan: moved([id!], 'approved') });
    expect(h.result.current.pending).toEqual([]);
    const next = moved([id!], 'approved');
    next.proposals.find((p) => p.id === id)!.status = 'executing';
    h.rerender({ scan: next });
    expect(h.result.current.pending).toEqual([expect.objectContaining({ id, from: 'approved', to: 'executing' })]);
    // someone else's id in a later read is news
    const both = moved([other!], 'declined');
    both.proposals.find((p) => p.id === id)!.status = 'executing';
    h.rerender({ scan: both });
    expect(h.result.current.pending.some((c) => c.kind === 'status' && c.id === other)).toBe(true);
  });

  it('opening the list clears the chip', () => {
    const h = mount();
    h.rerender({ scan: moved(waiting().slice(0, 2), 'declined') });
    expect(h.result.current.pending).toHaveLength(2);
    act(() => h.result.current.markSeen());
    expect(h.result.current.pending).toHaveLength(0);
  });
});
