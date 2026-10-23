import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// The Activity wall's two tab-local lanes refetch whenever the Overview range
// changes. Neither guarded its reply, so a slow 30-day read that landed after
// the 1-day read replaced the 1-day figures under the 1-day label.

let days = 30;
vi.mock('@/features/overview/components/dashboard/OverviewFilterContext', () => ({
  useOverviewFilterValues: () => ({ effectiveDays: days }),
}));

type Pending = { days: number; resolve: (v: unknown) => void };
const spend: Pending[] = [];
const athena: Pending[] = [];
vi.mock('@/api/llmSpend', () => ({
  llmSpendDashboard: (d: number) => new Promise((resolve) => { spend.push({ days: d, resolve }); }),
}));
vi.mock('@/api/companion', () => ({
  companionGetUsageDashboard: (d: number) => new Promise((resolve) => { athena.push({ days: d, resolve }); }),
}));

import { useLlmSpend } from '../useLlmSpend';
import { useAthenaUsage } from '../useAthenaUsage';

beforeEach(() => {
  days = 30;
  spend.length = 0;
  athena.length = 0;
});

describe.each([
  ['useLlmSpend', useLlmSpend, spend],
  ['useAthenaUsage', useAthenaUsage, athena],
] as const)('%s', (_name, useHook, calls) => {
  it('keeps the newest range when an older reply lands last', async () => {
    const { result, rerender } = renderHook(() => useHook());
    days = 1;
    rerender();
    expect(calls.map((c) => c.days)).toEqual([30, 1]);

    await act(async () => { calls[1]!.resolve({ window: 1 }); });
    await act(async () => { calls[0]!.resolve({ window: 30 }); });

    expect(result.current.data).toEqual({ window: 1 });
    expect(result.current.loading).toBe(false);
  });
});
