/**
 * "Run now" records the run on the automation row (system_ops_run_now ->
 * repo::mark_run), so the panel must re-read the rows afterwards or the click
 * leaves "ran 3 days ago" on screen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const { listSystemOpKinds, listSystemOpAutomations, runSystemOpNow } = vi.hoisted(() => ({
  listSystemOpKinds: vi.fn(),
  listSystemOpAutomations: vi.fn(),
  runSystemOpNow: vi.fn(),
}));

vi.mock('@/api/systemOps', () => ({
  listSystemOpKinds: (...a: unknown[]) => listSystemOpKinds(...a),
  listSystemOpAutomations: (...a: unknown[]) => listSystemOpAutomations(...a),
  runSystemOpNow: (...a: unknown[]) => runSystemOpNow(...a),
  setSystemOpAutomationEnabled: vi.fn(),
  deleteSystemOpAutomation: vi.fn(),
}));

import { useSystemOpStudio } from '../useSystemOpStudio';

const ROW = { id: 'auto-1', opKind: 'context_scan', lastRunAt: '2026-10-16T03:00:00Z', lastStatus: 'ok' };

afterEach(() => { vi.clearAllMocks(); });

describe('useSystemOpStudio.runNow', () => {
  it('re-reads the automations after a successful run', async () => {
    listSystemOpKinds.mockResolvedValue([]);
    listSystemOpAutomations.mockResolvedValueOnce([ROW]);
    const { result } = renderHook(() => useSystemOpStudio());
    await waitFor(() => expect(result.current.automations).toHaveLength(1));

    runSystemOpNow.mockResolvedValue('started');
    listSystemOpAutomations.mockResolvedValueOnce([{ ...ROW, lastRunAt: '2026-10-19T21:00:00Z' }]);
    let ok = false;
    await act(async () => { ok = await result.current.runNow('auto-1'); });

    expect(ok).toBe(true);
    expect(result.current.automations[0]?.lastRunAt).toBe('2026-10-19T21:00:00Z');
  });

  it('does not refresh when the run was refused', async () => {
    listSystemOpKinds.mockResolvedValue([]);
    listSystemOpAutomations.mockResolvedValue([ROW]);
    const { result } = renderHook(() => useSystemOpStudio());
    await waitFor(() => expect(result.current.automations).toHaveLength(1));
    const reads = listSystemOpAutomations.mock.calls.length;

    runSystemOpNow.mockRejectedValue({ error: 'Not found: automation', kind: 'not_found' });
    let ok = true;
    await act(async () => { ok = await result.current.runNow('auto-1'); });

    expect(ok).toBe(false);
    expect(listSystemOpAutomations.mock.calls.length).toBe(reads);
  });
});
