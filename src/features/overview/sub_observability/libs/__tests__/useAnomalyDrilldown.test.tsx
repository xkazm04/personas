// A failed drill-down read rejects with a serialized AppError object (invokeWithTimeout never
// rejects with an Error), so the panel must resolve it to copy, never print "[object Object]".
import { act, render, renderHook } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));

import { useAnomalyDrilldown } from '../useAnomalyDrilldown';
import AnomalyDrilldownPanel from '../../components/AnomalyDrilldownPanel';

const anomaly = (date: string): MetricAnomaly => ({ date, metric: 'cost', value: 9, baseline: 2, deviation_pct: 350 });

describe('useAnomalyDrilldown', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });
  beforeEach(() => invokeMock.mockReset());

  it('keeps an IPC rejection raw and the panel renders readable copy, not [object Object]', async () => {
    invokeMock.mockResolvedValue(undefined).mockRejectedValueOnce({ error: 'database is locked', kind: 'Database' });
    const { result } = renderHook(() => useAnomalyDrilldown());
    await act(async () => { await result.current.openDrilldown(anomaly('2026-10-01')); });
    expect(result.current.error).toEqual({ raw: { error: 'database is locked', kind: 'Database' } });

    const { container } = render(
      <AnomalyDrilldownPanel anomaly={anomaly('2026-10-01')} data={null} loading={false} error={result.current.error} onClose={() => {}} />,
    );
    expect(document.body.textContent).not.toContain('[object Object]');
    expect(container).toBeTruthy();
  });

  it('a slower first click cannot overwrite the second click\'s panel', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    invokeMock
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ correlatedEvents: [], rootCauseSuggestions: [], marker: 'B' });
    const { result } = renderHook(() => useAnomalyDrilldown());
    let first: Promise<void> = Promise.resolve();
    act(() => { first = result.current.openDrilldown(anomaly('2026-10-01')); });
    await act(async () => { await result.current.openDrilldown(anomaly('2026-10-02')); });
    await act(async () => { resolveFirst({ correlatedEvents: [], rootCauseSuggestions: [], marker: 'A' }); await first; });
    expect(result.current.selectedAnomaly?.date).toBe('2026-10-02');
    expect(result.current.drilldownData).toMatchObject({ marker: 'B' });
  });
});
