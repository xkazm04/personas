import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));
vi.mock('@/api/devTools/kpis', () => ({
  listKpiBindings: () => Promise.resolve([]),
}));

const row = (id: string, kpi_id: string): DevKpiMeasurement =>
  ({ id, kpi_id, value: 1, measured_at: '2026-10-01 00:00:00', source: 'manual', env: 'production', evidence: null, note: null }) as DevKpiMeasurement;

// The store's single list still holds KPI A's history (the read for B has not
// landed, or A's slower read landed after it).
const state = {
  kpiMeasurements: [row('a1', 'kpi-a'), row('a2', 'kpi-a')],
  goals: [],
  fetchKpiMeasurements: vi.fn(() => Promise.resolve()),
  fetchGoals: vi.fn(() => Promise.resolve()),
  recordKpiMeasurement: vi.fn(),
  evaluateKpi: vi.fn(),
  updateKpi: vi.fn(),
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof state) => unknown) => sel(state),
}));

import { useKpiDetail } from '../useKpiDetail';

describe('useKpiDetail', () => {
  it("never hands one KPI another KPI's measurements", () => {
    const { result } = renderHook(() => useKpiDetail({ id: 'kpi-b', project_id: 'p' } as DevKpi));
    expect(result.current.measurements).toEqual([]);
  });

  it("returns the open KPI's own rows", () => {
    state.kpiMeasurements = [row('a1', 'kpi-a'), row('b1', 'kpi-b')];
    const { result } = renderHook(() => useKpiDetail({ id: 'kpi-b', project_id: 'p' } as DevKpi));
    expect(result.current.measurements.map((m) => m.id)).toEqual(['b1']);
  });
});

describe('useKpiDetail.recordManual', () => {
  it('reports whether the reading was stored, so a failed write keeps the typed value', async () => {
    const { result } = renderHook(() => useKpiDetail({ id: 'kpi-b', project_id: 'p' } as DevKpi));

    state.recordKpiMeasurement.mockImplementationOnce(() => Promise.reject({ error: 'locked', kind: 'database' }));
    await expect(result.current.recordManual(5)).resolves.toBe(false);

    state.recordKpiMeasurement.mockImplementationOnce(() => Promise.resolve());
    await expect(result.current.recordManual(5)).resolves.toBe(true);
  });
});
