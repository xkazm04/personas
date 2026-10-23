import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * A KPI console edit is saved even when the operator leaves inside the
 * debounce window.
 *
 * The calibration sliders and the assessment editor write into FactoryShell
 * state, and a 600 ms debounce persisted them. Its cleanup only CLEARED the
 * timer, and the cleanup also runs when the console closes (Back, a crumb, a
 * project switch) or the Factory unmounts. A rating or a slider set in the
 * last 600 ms before leaving stayed on screen and never reached dev_kpis, so
 * the next load showed the old value.
 */
const saveKpiAssessment = vi.fn().mockResolvedValue({});
vi.mock('@/api/devTools/kpis', () => ({
  saveKpiAssessment: (...a: unknown[]) => saveKpiAssessment(...a),
}));

import { useKpiEditAutosave } from '../useKpiEditAutosave';
import type { KpiEdit } from '../factoryModel';

type P = { kpiId: string | null; edits: Record<string, KpiEdit> };

describe('useKpiEditAutosave', () => {
  beforeEach(() => { vi.useFakeTimers(); saveKpiAssessment.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it('debounces: a burst of edits saves once, with the last value', () => {
    const { rerender } = renderHook((p: P) => useKpiEditAutosave(p.kpiId, p.edits), {
      initialProps: { kpiId: 'k1', edits: {} },
    });
    rerender({ kpiId: 'k1', edits: { k1: { rating: 2 } } });
    rerender({ kpiId: 'k1', edits: { k1: { rating: 4 } } });
    vi.advanceTimersByTime(600);
    expect(saveKpiAssessment).toHaveBeenCalledTimes(1);
    expect(saveKpiAssessment.mock.calls[0]![1]).toMatchObject({ manualRating: 4 });
  });

  it('closing the console inside the window still saves the edit', () => {
    const { rerender } = renderHook((p: P) => useKpiEditAutosave(p.kpiId, p.edits), {
      initialProps: { kpiId: 'k1', edits: {} },
    });
    rerender({ kpiId: 'k1', edits: { k1: { warnAt: 7 } } });
    vi.advanceTimersByTime(200);
    rerender({ kpiId: null, edits: { k1: { warnAt: 7 } } }); // Back to the table
    vi.advanceTimersByTime(1000);
    expect(saveKpiAssessment).toHaveBeenCalledTimes(1);
    expect(saveKpiAssessment.mock.calls[0]).toEqual(['k1', expect.objectContaining({ warnAt: 7 })]);
  });

  it('unmounting inside the window still saves the edit', () => {
    const { rerender, unmount } = renderHook((p: P) => useKpiEditAutosave(p.kpiId, p.edits), {
      initialProps: { kpiId: 'k1', edits: {} },
    });
    rerender({ kpiId: 'k1', edits: { k1: { pros: 'stable' } } });
    unmount();
    expect(saveKpiAssessment).toHaveBeenCalledTimes(1);
    expect(saveKpiAssessment.mock.calls[0]![1]).toMatchObject({ pros: 'stable' });
  });

  it('a save that already fired is not repeated on close', () => {
    const { rerender } = renderHook((p: P) => useKpiEditAutosave(p.kpiId, p.edits), {
      initialProps: { kpiId: 'k1', edits: { k1: { rating: 3 } } },
    });
    vi.advanceTimersByTime(600);
    rerender({ kpiId: null, edits: { k1: { rating: 3 } } });
    expect(saveKpiAssessment).toHaveBeenCalledTimes(1);
  });
});
