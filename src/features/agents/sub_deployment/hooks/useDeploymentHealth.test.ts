import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';

const statsMock = vi.fn();
const silentCatchSpy = vi.fn();
vi.mock('@/api/system/cloud', () => ({ cloudExecutionStats: (...a: unknown[]) => statsMock(...a) }));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => silentCatchSpy }));

import { useDeploymentHealth } from './useDeploymentHealth';

const daily = [{ date: '2026-09-01', count: 3, successRate: 1, cost: 0.1 }];

describe('useDeploymentHealth', () => {
  beforeEach(() => { statsMock.mockReset(); silentCatchSpy.mockReset(); });

  it('maps stats back to every row that shares the persona, fetching each persona once', async () => {
    statsMock.mockResolvedValue({ dailyBreakdown: daily });
    const rows = [
      { id: 'cloud-1', personaId: 'p1' },
      { id: 'cloud-2', personaId: 'p1' },
      { id: 'gitlab-3', personaId: null },
    ];
    const { result } = renderHook(() => useDeploymentHealth(rows));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(statsMock).toHaveBeenCalledTimes(1);
    expect(statsMock).toHaveBeenCalledWith('p1', 7);
    expect(Object.keys(result.current.healthMap).sort()).toEqual(['cloud-1', 'cloud-2']);
    expect(result.current.healthMap['cloud-1']![0]!.count).toBe(3);
  });

  it('still loads when the effect is torn down mid-fetch (StrictMode mount replay)', async () => {
    statsMock.mockResolvedValue({ dailyBreakdown: daily });
    const rows = [{ id: 'cloud-1', personaId: 'p1' }];
    const { result } = renderHook(() => useDeploymentHealth(rows), { wrapper: StrictMode });
    await waitFor(() => expect(Object.keys(result.current.healthMap)).toEqual(['cloud-1']));
    expect(result.current.isLoading).toBe(false);
  });

  it('still loads when a row joins for a persona whose stats are already in flight', async () => {
    let resolve!: (v: unknown) => void;
    statsMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const first = [{ id: 'cloud-1', personaId: 'p1' }];
    const { result, rerender } = renderHook(({ rows }) => useDeploymentHealth(rows), { initialProps: { rows: first } });
    rerender({ rows: [...first, { id: 'cloud-2', personaId: 'p1' }] });
    await act(async () => { resolve({ dailyBreakdown: daily }); });
    await waitFor(() => expect(Object.keys(result.current.healthMap).sort()).toEqual(['cloud-1', 'cloud-2']));
  });

  it('never paints cloud execution stats onto a GitLab row that shares the persona', async () => {
    statsMock.mockResolvedValue({ dailyBreakdown: daily });
    const rows = [
      { id: 'cloud-1', personaId: 'p1', target: 'cloud' as const },
      { id: 'gitlab-a1', personaId: 'p1', target: 'gitlab' as const },
      { id: 'gitlab-a2', personaId: 'p2', target: 'gitlab' as const },
    ];
    const { result } = renderHook(() => useDeploymentHealth(rows));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(Object.keys(result.current.healthMap)).toEqual(['cloud-1']);
    expect(statsMock).toHaveBeenCalledTimes(1);
    expect(statsMock).toHaveBeenCalledWith('p1', 7);
  });

  it('keeps the fulfilled personas and reports a rejected one instead of dropping it silently', async () => {
    statsMock.mockImplementation((pid: string) =>
      pid === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve({ dailyBreakdown: daily }),
    );
    const rows = [
      { id: 'a', personaId: 'good' },
      { id: 'b', personaId: 'bad' },
    ];
    const { result } = renderHook(() => useDeploymentHealth(rows));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(Object.keys(result.current.healthMap)).toEqual(['a']);
    expect(silentCatchSpy).toHaveBeenCalledTimes(1);
    expect((silentCatchSpy.mock.calls[0]![0] as Error).message).toBe('boom');
  });
});
