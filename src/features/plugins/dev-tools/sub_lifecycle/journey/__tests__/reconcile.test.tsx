import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';

import { useLifecycleReconcile } from '../useLifecycleReconcile';
import { useLifecycleSnapshot } from '../useLifecycleSnapshot';
import { healthyMix } from './fixtures';

// A `dev_lifecycle_*` push lost in CDC's bounded channel must heal when the
// Lifecycle page is re-entered, focused or re-shown, not only when a Ship view
// happens to reconcile (u053's card: zero lifecycle callers of the reconcile).

const getLifecycle = vi.hoisted(() => vi.fn());
const cdcDroppedCount = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycle }));
vi.mock('@/api/system/system', () => ({ cdcDroppedCount }));

beforeEach(() => {
  vi.clearAllMocks();
  useDevToolsLiveStore.setState({ lastSeenCdcDrops: null, reconciling: false });
  getLifecycle.mockImplementation(async (id: string) => healthyMix({ projectId: id }));
});

describe('the Lifecycle page reconciles the CDC drop counter', () => {
  it('refetches the snapshot on window focus once a push was dropped', async () => {
    cdcDroppedCount.mockResolvedValue(3);
    const { result } = renderHook(() => {
      useLifecycleReconcile();
      return useLifecycleSnapshot('p-reconcile');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(useDevToolsLiveStore.getState().lastSeenCdcDrops).toBe(3));
    expect(getLifecycle).toHaveBeenCalledTimes(1);

    // Nothing dropped since the baseline: focus costs one integer read, no refetch.
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(cdcDroppedCount).toHaveBeenCalledTimes(2));
    expect(getLifecycle).toHaveBeenCalledTimes(1);

    // A push was shed while the window was away.
    cdcDroppedCount.mockResolvedValue(4);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(getLifecycle).toHaveBeenCalledTimes(2));
  });

  it('is mounted by the page itself', () => {
    const src = readFileSync(resolve(__dirname, '../../LifecyclePage.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/\buseLifecycleReconcile\(\)/);
  });
});
