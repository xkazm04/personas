import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// The status page reads each persona's day bars from HealthBundle.personaDaily.
// A failed daily read greys every bar, so it must reach the banner instead of
// passing for "no activity".

const bundleErrors = {
  monthlySpend: null, healingIssues: null, byomPolicy: null, providerStats: null,
  personaStats: null, personaDaily: 'persona daily query failed',
};
vi.mock('@/api/overview/sla', () => ({ getSlaDashboard: () => Promise.resolve({ persona_stats: [] }) }));
vi.mock('@/api/overview/health', () => ({
  getHealthBundle: () => Promise.resolve({
    monthlySpend: null, healingIssues: [], byomPolicy: null, providerStats: null,
    personaStats: null, personaDaily: null, errors: bundleErrors,
  }),
}));
const storeState = { executionDashboard: null, fetchExecutionDashboard: () => Promise.resolve() };
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: (sel: (s: typeof storeState) => unknown) => sel(storeState),
}));
vi.mock('@/lib/storeBus', () => ({ storeBus: { tryGet: () => [] }, AccessorKey: { AGENTS_PERSONAS: 'p' } }));

import { useStatusPageData } from './useStatusPageData';

describe('useStatusPageData per-persona daily series', () => {
  it('a failed daily read reaches the combined error', async () => {
    const { result } = renderHook(() => useStatusPageData());
    await waitFor(() => expect(result.current.error).toBe('persona daily query failed'));
  });
});
