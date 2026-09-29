// Scene settle gate: verdicts wait for every verdict-bearing family, a failure
// counts as an answer, the ceiling opens a stuck gate, and the first settle
// latches for the session. deriveScene draws unsettled islands provisional.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveScene } from '../lib/deriveScene';
import { __resetSceneSettleForTests, isSceneSettled, useSceneSettle, type SettleInputs } from '../lib/useSceneSettle';
import { makePassport } from './passportFactory';

const ready: SettleInputs = { passportsReady: true, families: ['loaded', 'loaded', 'failed', 'stale', 'loaded'], factoryReady: true, shipReady: true };

describe('isSceneSettled', () => {
  it('opens when every family has answered, a failure included', () => {
    expect(isSceneSettled(ready)).toBe(true);
  });
  it('holds while any family is idle or loading, or an input is not ready', () => {
    expect(isSceneSettled({ ...ready, families: ['loaded', 'loading'] })).toBe(false);
    expect(isSceneSettled({ ...ready, families: ['idle'] })).toBe(false);
    expect(isSceneSettled({ ...ready, passportsReady: false })).toBe(false);
    expect(isSceneSettled({ ...ready, factoryReady: false })).toBe(false);
    expect(isSceneSettled({ ...ready, shipReady: false })).toBe(false);
  });
});

describe('useSceneSettle', () => {
  beforeEach(() => { vi.useFakeTimers(); __resetSceneSettleForTests(); });
  afterEach(() => { vi.useRealTimers(); __resetSceneSettleForTests(); });

  it('stays closed while families load, opens when they answer, and stays open', () => {
    const { result, rerender } = renderHook((p: SettleInputs) => useSceneSettle(p), { initialProps: { ...ready, families: ['loading'] } });
    expect(result.current).toBe(false);
    rerender(ready);
    expect(result.current).toBe(true);
    // A later reload of a family does not close the gate again.
    rerender({ ...ready, families: ['loading'] });
    expect(result.current).toBe(true);
  });

  it('opens at the ceiling when a family never answers', () => {
    const { result } = renderHook(() => useSceneSettle({ ...ready, families: ['idle'] }, 5000));
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(true);
  });

  it('latches for the session: a remount starts open', () => {
    const first = renderHook(() => useSceneSettle(ready));
    expect(first.result.current).toBe(true);
    first.unmount();
    const again = renderHook(() => useSceneSettle({ ...ready, families: ['loading'] }));
    expect(again.result.current).toBe(true);
  });
});

describe('deriveScene settled flag', () => {
  it('draws every island provisional until settled, then with its verdict', () => {
    const passports = [makePassport()];
    const early = deriveScene(passports, null, false, undefined, undefined, undefined, {}, undefined, undefined, false);
    expect(early.islands[0]!.provisional).toBe(true);
    expect(early.islands[0]!.nodes.every((n) => n.status === 'unknown')).toBe(true);
    const settled = deriveScene(passports, null, false, undefined, undefined, undefined, {}, undefined, undefined, true);
    expect(settled.islands[0]!.provisional).toBeUndefined();
    // Identity and position do not move between the two.
    expect(settled.islands[0]!.slug).toBe(early.islands[0]!.slug);
    expect([settled.islands[0]!.x, settled.islands[0]!.y]).toEqual([early.islands[0]!.x, early.islands[0]!.y]);
  });
});
