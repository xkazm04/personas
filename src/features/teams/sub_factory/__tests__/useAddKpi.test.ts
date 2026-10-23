import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Retrying "Create KPI" after a partial failure does not create a second KPI.
 *
 * A manual KPI is two writes: `createKpi` (which takes no tier) and then
 * `updateKpi(id, { tier })` for any tier but the default. When the second
 * write failed, the form showed the error and stayed open with Create enabled,
 * while the first write had already committed an active KPI. Pressing Create
 * again inserted ANOTHER one. The created id is now kept, so a retry only
 * finishes the step that failed.
 */
const createKpi = vi.fn();
const updateKpi = vi.fn();
vi.mock('@/api/devTools/kpis', () => ({
  createKpi: (...a: unknown[]) => createKpi(...a),
  updateKpi: (...a: unknown[]) => updateKpi(...a),
  proposeKpiAuto: vi.fn(),
}));
vi.mock('@/api/vault/credentials', () => ({ listCredentials: vi.fn().mockResolvedValue([]) }));

import { useAddKpi } from '../useAddKpi';

describe('useAddKpi.createManual', () => {
  beforeEach(() => {
    createKpi.mockReset().mockResolvedValue({ id: 'kpi-1' });
    updateKpi.mockReset();
  });

  it('a retry after the tier write failed reuses the created KPI', async () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useAddKpi({ projectId: 'p1', onClose }));
    act(() => {
      result.current.setName('p95 latency');
      result.current.setUnit('ms');
      result.current.setBaseline('400');
      result.current.setTarget('200');
      result.current.setTier('primary');
    });

    updateKpi.mockRejectedValueOnce({ error: 'database is locked', kind: 'Database' });
    await act(async () => { await result.current.createManual(); });
    expect(result.current.msg).toBe('database is locked');
    expect(onClose).not.toHaveBeenCalled();

    updateKpi.mockResolvedValueOnce({ id: 'kpi-1' });
    await act(async () => { await result.current.createManual(); });

    expect(createKpi).toHaveBeenCalledTimes(1);
    expect(updateKpi).toHaveBeenLastCalledWith('kpi-1', expect.objectContaining({ tier: 'primary', name: 'p95 latency', targetValue: 200 }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
