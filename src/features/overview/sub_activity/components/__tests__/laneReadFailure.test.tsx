import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Four lanes on the Metrics wall each read their own IPC. A failed read fell
// through to the "nothing here" branch: the two spend lanes said "no activity
// in this window", and the value / failure-category sections rendered nothing,
// which is exactly how a clean window with no failures looks.

vi.mock('@/features/overview/components/dashboard/OverviewFilterContext', () => ({
  useOverviewFilterValues: () => ({ effectiveDays: 7 }),
}));

const ipcError = { error: 'database is locked', kind: 'Database' };
const getErrorCategoryBreakdown = vi.fn();
const getValueRollup = vi.fn();
vi.mock('@/api/overview/observability', () => ({
  getErrorCategoryBreakdown: (...a: unknown[]) => getErrorCategoryBreakdown(...a),
  getValueRollup: (...a: unknown[]) => getValueRollup(...a),
}));
vi.mock('@/api/llmSpend', () => ({ llmSpendDashboard: () => Promise.reject(ipcError) }));
vi.mock('@/api/companion', () => ({ companionGetUsageDashboard: () => Promise.reject(ipcError) }));

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { ErrorCategorySection } from '../ErrorCategorySection';
import { ValueRollupSection } from '../ValueRollupSection';
import { LlmSpendSection } from '../LlmSpendSection';
import { AthenaUsageSection } from '../AthenaUsageSection';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['overview']);
});

const FAILED = /failed to load/i;

describe('a lane whose read fails says so', () => {
  it('failure categories: a failed read is not a clean window, and retry re-reads', async () => {
    getErrorCategoryBreakdown.mockRejectedValueOnce(ipcError).mockResolvedValueOnce({
      totalFailures: 0, priorTotalFailures: 0, categories: [], personaTopCategories: [],
    });
    render(<ErrorCategorySection days={7} />);
    expect(await screen.findByText(FAILED)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(getErrorCategoryBreakdown).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(FAILED)).toBeNull());
  });

  it('business value: a failed read is reported, not hidden', async () => {
    getValueRollup.mockRejectedValueOnce(ipcError);
    render(<ValueRollupSection days={7} />);
    expect(await screen.findByText(FAILED)).toBeTruthy();
  });

  it('headless LLM spend: a failed read is not "no activity"', async () => {
    render(<LlmSpendSection />);
    expect(await screen.findByText(FAILED)).toBeTruthy();
  });

  it('Athena usage: a failed read is not "no activity"', async () => {
    render(<AthenaUsageSection fleetCost={null} />);
    expect(await screen.findByText(FAILED)).toBeTruthy();
  });
});
