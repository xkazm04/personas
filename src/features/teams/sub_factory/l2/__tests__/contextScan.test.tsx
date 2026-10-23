/**
 * "Scan this context" runs a real context-scoped KPI scan. The button used to
 * only post a "arrives with the unified dispatch concept" note, and the TS
 * wrapper scanKpis(projectId) dropped the context_id the backend
 * (dev_tools_scan_kpis) already takes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tauriInvoke', () => ({ invokeWithTimeout: invoke }));
vi.mock('@/api/devTools/devTools', () => ({ scanCodebase: vi.fn() }));
vi.mock('@/lib/silentCatch', () => ({ toastCatch: () => () => undefined, silentCatch: () => () => undefined }));
vi.mock('@/hooks/useTauriEvent', () => ({ useTauriEvent: vi.fn() }));
vi.mock('@/stores/overviewStore', () => ({ useOverviewStore: { getState: vi.fn() } }));

import { scanKpis } from '@/api/devTools/kpis';
import { useFactoryScans } from '../useFactoryScans';
import type { FactoryL2Data } from '../factoryL2Data';

describe('context-scoped KPI scan', () => {
  beforeEach(() => invoke.mockReset());

  it('the wrapper sends the context id, or null for a project-wide scan', async () => {
    invoke.mockResolvedValue({ scan_id: 's1' });
    await scanKpis('p1', 'c9');
    await scanKpis('p1');
    expect(invoke.mock.calls[0][1]).toEqual({ projectId: 'p1', contextId: 'c9' });
    expect(invoke.mock.calls[1][1]).toEqual({ projectId: 'p1', contextId: null });
  });

  it('scanKpisNow(contextId) starts the scan for that context', async () => {
    vi.useFakeTimers();
    try {
      // Start resolves a scan id; every status read after it is terminal.
      invoke.mockResolvedValue({ scan_id: 's1', status: 'completed' });
      const data = { project: { id: 'p1', name: 'P', root_path: '/p' }, reloadKpis: vi.fn() } as unknown as FactoryL2Data;
      const { result } = renderHook(() => useFactoryScans(data, vi.fn()));
      await act(async () => {
        const run = result.current.scanKpisNow('c9');
        await vi.advanceTimersByTimeAsync(5_000);
        await run;
      });
      expect(invoke).toHaveBeenCalledWith('dev_tools_scan_kpis', { projectId: 'p1', contextId: 'c9' }, expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });
});
