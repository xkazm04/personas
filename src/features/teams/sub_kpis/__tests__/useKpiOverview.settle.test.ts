import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { DevKpi } from '@/lib/bindings/DevKpi';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));
// The context-group read never answers inside this test: it is the read the
// scope switch cancels.
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: () => new Promise(() => {}),
}));
vi.mock('@/features/plugins/dev-tools/sub_workspaces/usePickerScope', () => ({
  usePickerScope: () => ({ kind: 'all', projectIds: null, key: 'all' }),
  inPickerScope: () => true,
}));

const state: { kpis: DevKpi[]; projects: unknown[]; kpisLoading: boolean } = {
  kpis: [{ id: 'k1', project_id: 'p1', status: 'active' } as DevKpi],
  projects: [],
  kpisLoading: false,
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof state) => unknown) => sel(state),
}));

import { useKpiOverview } from '../useKpiOverview';

describe('useKpiOverview', () => {
  it('settles loading when the last project with active KPIs leaves scope mid-read', () => {
    const { result, rerender } = renderHook(() => useKpiOverview());
    expect(result.current.loading).toBe(true); // groups read in flight

    state.kpis = [{ id: 'k1', project_id: 'p1', status: 'paused' } as DevKpi];
    rerender();

    expect(result.current.overview).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
