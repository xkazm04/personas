import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';

import { joinHealth } from '../../lifecycleView/layer1/healthModel';
import { buildLanes } from '../journeyModel';
import { useLifecycleSnapshot } from '../useLifecycleSnapshot';
import { healthyMix } from './fixtures';

// Wave 10 (measured with scripts/style/lifecycle-perf.mjs): a backend event that
// changes nothing this page draws must re-render nothing. The snapshot read hands
// back the SAME object for the same data, and the rail's joined steps are kept
// per health row, so a memoised card skips its render.

const getLifecycle = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycle }));

describe('a revision that brought the same data back', () => {
  it('keeps the snapshot object, and takes a new one when the data changed', async () => {
    getLifecycle.mockImplementation(async () => healthyMix({ projectId: 'p-same' }));
    const { result } = renderHook(() => useLifecycleSnapshot('p-same'));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    const first = result.current.snapshot;

    act(() => { useDevToolsLiveStore.setState((s) => ({ lifecycleRevision: s.lifecycleRevision + 1 })); });
    await waitFor(() => expect(getLifecycle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.snapshot).toBe(first);

    getLifecycle.mockImplementation(async () => healthyMix({ projectId: 'p-same', watched: false }));
    act(() => { useDevToolsLiveStore.setState((s) => ({ lifecycleRevision: s.lifecycleRevision + 1 })); });
    await waitFor(() => expect(result.current.snapshot?.watched).toBe(false));
    expect(result.current.snapshot).not.toBe(first);
  });

  it('joins a step to its health row once: the same row gives the same step object', () => {
    const snap = healthyMix();
    const lanes = buildLanes(snap);
    const nodes = [...lanes.before, ...lanes.after];
    const a = joinHealth(nodes, snap.health);
    const b = joinHealth(nodes, snap.health);
    expect(b.every((s, i) => s === a[i])).toBe(true);
    // A new row for Gate only (a past Measure viewed): only Gate's step is new.
    const moved = snap.health.map((h) => (h.stepId === 'gate' ? { ...h, health: 'red' as const } : h));
    const c = joinHealth(nodes, moved);
    expect(c.filter((s, i) => s !== a[i]).map((s) => s.node.id)).toEqual(['gate']);
    expect(c.find((s) => s.node.id === 'gate')!.health).toBe('red');
  });
});
